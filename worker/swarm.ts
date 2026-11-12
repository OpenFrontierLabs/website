import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

// The swarm in D1: what the coordinator reports (POST /v1/swarm/ingest) and what the site reads back.
// Every write is an idempotent upsert, so the coordinator may repeat or reorder reports.

export const ONLINE_WINDOW_MS = 120_000;
const MAX_ROUNDS_PER_REPORT = 10;
const MAX_NODES = 16;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const RUN_STATUSES = ["waiting", "training", "done"] as const;

export class BadReport extends Error {}

export interface NodeIn {
  id: string;
  github: string | null;
  hostname: string;
  device: string;
  gpu: string;
  memoryGib: number;
  torch: string;
  firstSeen: number;
  lastHeartbeat: number;
}
export interface RunIn {
  id: string;
  model: string;
  params: number;
  rounds: number;
  status: (typeof RUN_STATUSES)[number];
  startedAt: number;
  endedAt: number | null;
  weightsHash: string | null;
  gitSha: string | null;
  initialValLoss: number | null;
  wallSeconds: number | null;
  nodes: string[];
}
export interface RoundIn {
  runId: string;
  round: number;
  valLoss: number;
  hashesAgree: boolean;
  elapsed: number;
  at: number;
  nodes: { nodeId: string; trainLoss: number; seconds: number }[];
}
export interface Report {
  nodes: NodeIn[];
  run: RunIn | null;
  rounds: RoundIn[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown, what: string): Obj => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new BadReport(`${what} must be an object`);
  return v as Obj;
};
const str = (o: Obj, k: string, max = 200): string => {
  const v = o[k];
  if (typeof v !== "string" || v.length === 0 || v.length > max) throw new BadReport(`${k} must be a non-empty string of at most ${max} characters`);
  return v;
};
const optStr = (o: Obj, k: string, max = 200): string | null => (o[k] === undefined || o[k] === null ? null : str(o, k, max));
const num = (o: Obj, k: string): number => {
  const v = o[k];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new BadReport(`${k} must be a finite number`);
  return v;
};
const optNum = (o: Obj, k: string): number | null => (o[k] === undefined || o[k] === null ? null : num(o, k));
const int = (o: Obj, k: string): number => {
  const v = num(o, k);
  if (!Number.isInteger(v) || v < 0) throw new BadReport(`${k} must be a non-negative integer`);
  return v;
};
const list = (o: Obj, k: string, max: number): unknown[] => {
  const v = o[k] ?? [];
  if (!Array.isArray(v) || v.length > max) throw new BadReport(`${k} must be a list of at most ${max}`);
  return v;
};

/** Validates one report once, at the door; everything after trusts the types. `now` stands in for absent times. */
export function parseReport(body: unknown, now: number): Report {
  const o = obj(body, "report");
  const nodes = list(o, "nodes", MAX_NODES).map((raw): NodeIn => {
    const n = obj(raw, "node");
    const github = optStr(n, "github", 39)?.replace(/^@/, "") ?? null;
    if (github !== null && !LOGIN.test(github)) throw new BadReport("github is not a valid GitHub login");
    return {
      id: str(n, "id"),
      github,
      hostname: str(n, "hostname"),
      device: str(n, "device", 20),
      gpu: str(n, "gpu"),
      memoryGib: num(n, "memory_gib"),
      torch: str(n, "torch", 40),
      firstSeen: optNum(n, "first_seen") ?? now,
      lastHeartbeat: optNum(n, "last_heartbeat") ?? now,
    };
  });
  let run: RunIn | null = null;
  if (o.run !== undefined && o.run !== null) {
    const r = obj(o.run, "run");
    const status = str(r, "status", 20);
    if (!(RUN_STATUSES as readonly string[]).includes(status)) throw new BadReport(`status must be one of ${RUN_STATUSES.join(", ")}`);
    run = {
      id: str(r, "id", 80),
      model: str(r, "model"),
      params: int(r, "params"),
      rounds: int(r, "rounds"),
      status: status as RunIn["status"],
      startedAt: optNum(r, "started_at") ?? now,
      endedAt: optNum(r, "ended_at"),
      weightsHash: optStr(r, "weights_hash", 64),
      gitSha: optStr(r, "git_sha", 64),
      initialValLoss: optNum(r, "initial_val_loss"),
      wallSeconds: optNum(r, "wall_seconds"),
      nodes: list(r, "nodes", MAX_NODES).map((id) => {
        if (typeof id !== "string" || id.length === 0 || id.length > 200) throw new BadReport("run nodes must be node ids");
        return id;
      }),
    };
  }
  const rounds = list(o, "rounds", MAX_ROUNDS_PER_REPORT).map((raw): RoundIn => {
    const r = obj(raw, "round");
    const results = list(r, "nodes", MAX_NODES).map((x) => {
      const n = obj(x, "round node");
      return { nodeId: str(n, "node_id"), trainLoss: num(n, "train_loss"), seconds: num(n, "seconds") };
    });
    return {
      runId: str(r, "run_id", 80),
      round: int(r, "round"),
      valLoss: num(r, "val_loss"),
      hashesAgree: r.hashes_agree === true,
      elapsed: num(r, "elapsed"),
      at: optNum(r, "at") ?? now,
      nodes: results,
    };
  });
  return { nodes, run, rounds };
}

/** Applies a report as one batch. Order matters only for readability: no table references another by constraint. */
export async function ingest(db: D1Database, report: Report): Promise<void> {
  const st: D1PreparedStatement[] = [];
  for (const n of report.nodes) {
    st.push(
      db
        .prepare(
          `INSERT INTO swarm_nodes (id, github, hostname, device, gpu, memory_gib, torch, first_seen, last_heartbeat)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
           ON CONFLICT (id) DO UPDATE SET github = COALESCE(?2, github), hostname = ?3, device = ?4, gpu = ?5,
             memory_gib = ?6, torch = ?7, first_seen = MIN(first_seen, ?8), last_heartbeat = MAX(last_heartbeat, ?9)`,
        )
        .bind(n.id, n.github, n.hostname, n.device, n.gpu, n.memoryGib, n.torch, n.firstSeen, n.lastHeartbeat),
    );
  }
  const r = report.run;
  if (r) {
    st.push(
      db
        .prepare(
          `INSERT INTO swarm_runs (id, model, params, rounds, status, started_at, ended_at, weights_hash, git_sha, initial_val_loss, wall_seconds)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
           ON CONFLICT (id) DO UPDATE SET model = ?2, params = ?3, rounds = ?4, status = ?5, started_at = MIN(started_at, ?6),
             ended_at = COALESCE(?7, ended_at), weights_hash = COALESCE(?8, weights_hash), git_sha = COALESCE(?9, git_sha),
             initial_val_loss = COALESCE(?10, initial_val_loss), wall_seconds = COALESCE(?11, wall_seconds)`,
        )
        .bind(r.id, r.model, r.params, r.rounds, r.status, r.startedAt, r.endedAt, r.weightsHash, r.gitSha, r.initialValLoss, r.wallSeconds),
    );
    if (r.nodes.length > 0) {
      const marks = r.nodes.map((_, i) => `(?1, ?${i + 2})`).join(", ");
      st.push(db.prepare(`INSERT OR IGNORE INTO swarm_run_nodes (run_id, node_id) VALUES ${marks}`).bind(r.id, ...r.nodes));
    }
  }
  for (const x of report.rounds) {
    st.push(
      db
        .prepare("INSERT OR REPLACE INTO swarm_rounds (run_id, round, val_loss, hashes_agree, elapsed, at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(x.runId, x.round, x.valLoss, x.hashesAgree ? 1 : 0, x.elapsed, x.at),
    );
    if (x.nodes.length > 0) {
      const marks = x.nodes.map(() => "(?, ?, ?, ?, ?)").join(", ");
      st.push(
        db
          .prepare(`INSERT OR REPLACE INTO swarm_round_nodes (run_id, round, node_id, train_loss, seconds) VALUES ${marks}`)
          .bind(...x.nodes.flatMap((n) => [x.runId, x.round, n.nodeId, n.trainLoss, n.seconds])),
      );
    }
  }
  if (st.length > 0) await db.batch(st);
}

// ---- reads -------------------------------------------------------------------------------------

interface NodeRow {
  id: string;
  github: string | null;
  hostname: string;
  device: string;
  gpu: string;
  memory_gib: number;
  torch: string;
  first_seen: number;
  last_heartbeat: number;
}
export interface SwarmNode extends NodeRow {
  online: boolean;
  /** Seconds of training this node has contributed, and how many rounds it pushed. */
  compute_seconds: number;
  rounds: number;
}
export interface RunRow {
  id: string;
  model: string;
  params: number;
  rounds: number;
  status: string;
  started_at: number;
  ended_at: number | null;
  weights_hash: string | null;
  git_sha: string | null;
  initial_val_loss: number | null;
  wall_seconds: number | null;
}
export interface RoundOut {
  round: number;
  val_loss: number;
  hashes_agree: boolean;
  elapsed: number;
  at: number;
  nodes: { node_id: string; train_loss: number; seconds: number }[];
}
export interface LatestRun extends RunRow {
  /** `training` with no participant heartbeating inside the window is reported as `stalled`. */
  state: string;
  rounds_done: number;
  hashes_agree_all: boolean;
  participants: SwarmNode[];
  log: RoundOut[];
}
export interface Summary {
  generated_at: number;
  online_window_seconds: number;
  totals: { nodes_online: number; nodes_registered: number; runs: number; rounds: number; compute_seconds: number };
  devices: { device: string; registered: number; online: number }[];
  nodes: SwarmNode[];
  latest_run: LatestRun | null;
}

const NODE_STATS = `SELECT n.*, COALESCE(SUM(c.seconds), 0) AS compute_seconds, COUNT(c.run_id) AS rounds
  FROM swarm_nodes n LEFT JOIN swarm_round_nodes c ON c.node_id = n.id`;

const withOnline = (rows: (NodeRow & { compute_seconds: number; rounds: number })[], now: number): SwarmNode[] =>
  rows.map((r) => ({ ...r, online: now - r.last_heartbeat <= ONLINE_WINDOW_MS }));

export async function summary(db: D1Database, now = Date.now()): Promise<Summary> {
  const [nodeRes, totalRes, runRes] = await db.batch([
    db.prepare(`${NODE_STATS} GROUP BY n.id ORDER BY n.last_heartbeat DESC`),
    db.prepare("SELECT (SELECT COUNT(*) FROM swarm_runs) AS runs, (SELECT COUNT(*) FROM swarm_rounds) AS rounds, (SELECT COALESCE(SUM(seconds), 0) FROM swarm_round_nodes) AS compute"),
    db.prepare("SELECT * FROM swarm_runs ORDER BY started_at DESC LIMIT 1"),
  ]);
  const nodes = withOnline(nodeRes!.results as (NodeRow & { compute_seconds: number; rounds: number })[], now);
  const totals = totalRes!.results[0] as { runs: number; rounds: number; compute: number };
  const kinds = new Map<string, { registered: number; online: number }>();
  for (const n of nodes) {
    const k = kinds.get(n.device) ?? { registered: 0, online: 0 };
    k.registered += 1;
    if (n.online) k.online += 1;
    kinds.set(n.device, k);
  }
  const run = (runRes!.results[0] as RunRow | undefined) ?? null;
  return {
    generated_at: now,
    online_window_seconds: ONLINE_WINDOW_MS / 1000,
    totals: {
      nodes_online: nodes.filter((n) => n.online).length,
      nodes_registered: nodes.length,
      runs: totals.runs,
      rounds: totals.rounds,
      compute_seconds: totals.compute,
    },
    devices: [...kinds].map(([device, k]) => ({ device, ...k })).sort((a, b) => b.registered - a.registered || a.device.localeCompare(b.device)),
    nodes,
    latest_run: run ? await latestRun(db, run, nodes) : null,
  };
}

async function latestRun(db: D1Database, run: RunRow, nodes: SwarmNode[]): Promise<LatestRun> {
  const [roundRes, resultRes, memberRes] = await db.batch([
    db.prepare("SELECT round, val_loss, hashes_agree, elapsed, at FROM swarm_rounds WHERE run_id = ? ORDER BY round").bind(run.id),
    db.prepare("SELECT round, node_id, train_loss, seconds FROM swarm_round_nodes WHERE run_id = ? ORDER BY round, node_id").bind(run.id),
    db.prepare("SELECT node_id FROM swarm_run_nodes WHERE run_id = ? ORDER BY node_id").bind(run.id),
  ]);
  const byRound = new Map<number, RoundOut["nodes"]>();
  for (const x of resultRes!.results as { round: number; node_id: string; train_loss: number; seconds: number }[]) {
    const bucket = byRound.get(x.round) ?? [];
    bucket.push({ node_id: x.node_id, train_loss: x.train_loss, seconds: x.seconds });
    byRound.set(x.round, bucket);
  }
  const log = (roundRes!.results as { round: number; val_loss: number; hashes_agree: number; elapsed: number; at: number }[]).map((r) => ({
    ...r,
    hashes_agree: r.hashes_agree === 1,
    nodes: byRound.get(r.round) ?? [],
  }));
  const ids = new Set((memberRes!.results as { node_id: string }[]).map((m) => m.node_id));
  const participants = nodes.filter((n) => ids.has(n.id));
  const state = run.status === "training" && !participants.some((n) => n.online) ? "stalled" : run.status;
  return { ...run, state, rounds_done: log.length, hashes_agree_all: log.length > 0 && log.every((r) => r.hashes_agree), participants, log };
}

/** What one signed-in member has done: their nodes, the runs those nodes joined, and compute per day. */
export interface MemberSwarm {
  nodes: SwarmNode[];
  runs: (RunRow & { rounds_done: number; peers: number; final_val_loss: number | null; my_seconds: number; my_rounds: number })[];
  /** Training seconds per UTC day for the 30 days ending today. */
  daily_seconds: number[];
}

export async function memberSwarm(db: D1Database, login: string, now: Date): Promise<MemberSwarm> {
  const dayMs = 86_400_000;
  const today = Math.floor(now.getTime() / dayMs);
  const since = (today - 29) * dayMs;
  const [nodeRes, runRes, dayRes] = await db.batch([
    db.prepare(`${NODE_STATS} WHERE n.github = ?1 GROUP BY n.id ORDER BY n.first_seen`).bind(login),
    db
      .prepare(
        `SELECT r.*,
           (SELECT COUNT(*) FROM swarm_rounds x WHERE x.run_id = r.id) AS rounds_done,
           (SELECT COUNT(*) FROM swarm_run_nodes p WHERE p.run_id = r.id) AS peers,
           (SELECT val_loss FROM swarm_rounds x WHERE x.run_id = r.id ORDER BY round DESC LIMIT 1) AS final_val_loss,
           (SELECT COALESCE(SUM(c.seconds), 0) FROM swarm_round_nodes c JOIN swarm_nodes sn ON sn.id = c.node_id WHERE c.run_id = r.id AND sn.github = ?1) AS my_seconds,
           (SELECT COUNT(*) FROM swarm_round_nodes c JOIN swarm_nodes sn ON sn.id = c.node_id WHERE c.run_id = r.id AND sn.github = ?1) AS my_rounds
         FROM swarm_runs r
         WHERE EXISTS (SELECT 1 FROM swarm_run_nodes p JOIN swarm_nodes sn ON sn.id = p.node_id WHERE p.run_id = r.id AND sn.github = ?1)
         ORDER BY r.started_at DESC`,
      )
      .bind(login),
    db
      .prepare(
        `SELECT x.at / ${dayMs} AS day, SUM(c.seconds) AS seconds
         FROM swarm_round_nodes c JOIN swarm_rounds x ON x.run_id = c.run_id AND x.round = c.round JOIN swarm_nodes sn ON sn.id = c.node_id
         WHERE sn.github = ?1 AND x.at >= ?2 GROUP BY day`,
      )
      .bind(login, since),
  ]);
  const daily = Array.from({ length: 30 }, () => 0);
  for (const d of dayRes!.results as { day: number; seconds: number }[]) {
    const i = d.day - (today - 29);
    if (i >= 0 && i < 30) daily[i] = d.seconds;
  }
  return {
    nodes: withOnline(nodeRes!.results as (NodeRow & { compute_seconds: number; rounds: number })[], now.getTime()),
    runs: runRes!.results as MemberSwarm["runs"],
    daily_seconds: daily,
  };
}

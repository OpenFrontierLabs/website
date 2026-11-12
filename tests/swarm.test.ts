import type { D1Database } from "@cloudflare/workers-types";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BadReport, ingest, memberSwarm, ONLINE_WINDOW_MS, parseReport, summary } from "../worker/swarm";
import { memberRunTable, runCard } from "../worker/swarm-view";

/** The slice of D1 the swarm code uses, over an in-memory SQLite with the real migration applied. */
function d1(): D1Database {
  const sqlite = new Database(":memory:");
  sqlite.exec(readFileSync("migrations/0003_swarm.sql", "utf8"));
  const prepare = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => prepare(sql, a),
    all: async () => ({ results: sqlite.query(sql).all(...(args as never[])) }),
    run: async () => void sqlite.query(sql).run(...(args as never[])),
    sql,
    args,
  });
  return {
    prepare,
    batch: async (stmts: ReturnType<typeof prepare>[]) => stmts.map((s) => ({ results: sqlite.query(s.sql).all(...(s.args as never[])) })),
  } as unknown as D1Database;
}

const T0 = Date.UTC(2026, 10, 12, 12);
const node = (id: string, extra: object = {}) => ({ id, hostname: id.split("-")[0], device: "cuda", gpu: "RTX 5090", memory_gib: 23.4, torch: "2.11", ...extra });
const round = (n: number, at: number, agree = true) => ({
  run_id: "r1",
  round: n,
  val_loss: 3 - n * 0.5,
  hashes_agree: agree,
  elapsed: 10 * (n + 1),
  at,
  nodes: [
    { node_id: "a-cuda", train_loss: 2, seconds: 6 },
    { node_id: "b-mps", train_loss: 2.1, seconds: 4 },
  ],
});
const run = (status = "training", extra: object = {}) => ({ id: "r1", model: "char GPT", params: 1000, rounds: 3, status, started_at: T0, nodes: ["a-cuda", "b-mps"], initial_val_loss: 4, ...extra });

async function seeded() {
  const db = d1();
  const report = { nodes: [node("a-cuda", { github: "@Octo", last_heartbeat: T0 + 30_000 }), node("b-mps", { device: "mps", gpu: "M5", last_heartbeat: T0 })], run: run(), rounds: [round(0, T0 + 20_000), round(1, T0 + 40_000)] };
  await ingest(db, parseReport(report, T0));
  return db;
}

describe("report validation", () => {
  test("rejects malformed reports at the door", () => {
    expect(() => parseReport([], T0)).toThrow(BadReport);
    expect(() => parseReport({ nodes: [node("a", { github: "not a login!" })] }, T0)).toThrow("GitHub login");
    expect(() => parseReport({ nodes: [{ ...node("a"), memory_gib: "lots" }] }, T0)).toThrow(BadReport);
    expect(() => parseReport({ run: run("exploded") }, T0)).toThrow("status");
    expect(() => parseReport({ rounds: Array.from({ length: 11 }, (_, i) => round(i, T0)) }, T0)).toThrow(BadReport);
  });

  test("a heartbeat is just a node; absent times become now", () => {
    const r = parseReport({ nodes: [node("a-cuda", { github: "@octo" })] }, T0);
    expect(r.run).toBeNull();
    expect(r.nodes[0]).toMatchObject({ github: "octo", firstSeen: T0, lastHeartbeat: T0 });
  });
});

describe("ingest and summary", () => {
  test("totals, online window, devices and the latest run's chart data", async () => {
    const db = await seeded();
    const s = await summary(db, T0 + 30_000 + ONLINE_WINDOW_MS - 1);
    expect(s.totals).toEqual({ nodes_online: 1, nodes_registered: 2, runs: 1, rounds: 2, compute_seconds: 20 });
    expect(s.devices).toEqual([
      { device: "cuda", registered: 1, online: 1 },
      { device: "mps", registered: 1, online: 0 },
    ]);
    expect(s.latest_run).toMatchObject({ id: "r1", rounds_done: 2, state: "training", hashes_agree_all: true });
    expect(s.latest_run!.log.map((r) => r.val_loss)).toEqual([3, 2.5]);
    expect(s.latest_run!.log[1]!.nodes).toHaveLength(2);
    expect(s.latest_run!.participants.map((p) => p.id)).toEqual(["a-cuda", "b-mps"]);
  });

  test("a training run nobody heartbeats for is stalled, not training", async () => {
    const s = await summary(await seeded(), T0 + 30_000 + ONLINE_WINDOW_MS + 1);
    expect(s.totals.nodes_online).toBe(0);
    expect(s.latest_run!.state).toBe("stalled");
  });

  test("reports are idempotent and later reports update in place", async () => {
    const db = await seeded();
    await ingest(db, parseReport({ nodes: [node("a-cuda", { last_heartbeat: T0 - 99_000 })], rounds: [round(1, T0 + 40_000, false)] }, T0));
    await ingest(db, parseReport({ run: run("done", { ended_at: T0 + 60_000, weights_hash: "ab".repeat(32), wall_seconds: 60 }), rounds: [round(2, T0 + 60_000)] }, T0));
    const s = await summary(db, T0 + 61_000);
    const l = s.latest_run!;
    expect(s.totals).toMatchObject({ nodes_registered: 2, runs: 1, rounds: 3 });
    expect(l).toMatchObject({ state: "done", weights_hash: "ab".repeat(32), wall_seconds: 60, rounds_done: 3, hashes_agree_all: false });
    // An older heartbeat never moves a node's last heartbeat backwards, and github survives a report without it.
    expect(s.nodes.find((n) => n.id === "a-cuda")).toMatchObject({ last_heartbeat: T0 + 30_000, github: "Octo" });
  });
});

describe("member view", () => {
  test("only nodes attributed to the member, matched case-insensitively, with their runs and daily compute", async () => {
    const db = await seeded();
    const now = new Date(T0 + 60_000);
    const mine = await memberSwarm(db, "octo", now);
    expect(mine.nodes.map((n) => n.id)).toEqual(["a-cuda"]);
    expect(mine.nodes[0]).toMatchObject({ rounds: 2, compute_seconds: 12 });
    expect(mine.runs).toHaveLength(1);
    expect(mine.runs[0]).toMatchObject({ id: "r1", peers: 2, rounds_done: 2, my_rounds: 2, my_seconds: 12, final_val_loss: 2.5 });
    expect(mine.daily_seconds.at(-1)).toBe(12);
    expect(mine.daily_seconds.reduce((a, b) => a + b, 0)).toBe(12);
    const other = await memberSwarm(db, "someone-else", now);
    expect(other.nodes).toEqual([]);
    expect(other.runs).toEqual([]);
    expect(memberRunTable(other.runs, other.nodes)).toBe("");
  });
});

describe("rendering", () => {
  test("the run card draws the real losses and escapes reported text", async () => {
    const db = d1();
    await ingest(db, parseReport({ nodes: [node("a-cuda", { gpu: "<b>GPU</b>" })], run: run("training", { nodes: ["a-cuda"] }), rounds: [round(0, T0)] }, T0));
    const html = runCard(await summary(db, T0));
    expect(html).toContain("1/3");
    expect(html).toContain("&lt;b&gt;GPU&lt;/b&gt;");
    expect(html).not.toContain("<b>GPU</b>");
    expect(html).toMatch(/<path class="vl-line" d="M[^"]+L[^"]+"/);
  });
});

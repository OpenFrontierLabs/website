// D1 access for sign-ups and the audit trail.
import type { GitHubProfile } from "./github";
import { CONTRIBUTIONS, HARDWARE, type Answers } from "./questionnaire";

export const STATUSES = ["waitlisted", "invited", "active", "rejected"] as const;
export type Status = (typeof STATUSES)[number];

export interface UserRow {
  id: number;
  github_id: number;
  login: string;
  avatar_url: string;
  github_name: string;
  github_email: string;
  is_admin: number;
  status: Status;
  answers: string | null;
  created_at: string;
  updated_at: string;
}

export const parseAnswers = (row: UserRow): Answers | null => (row.answers ? (JSON.parse(row.answers) as Answers) : null);

export async function upsertUser(db: D1Database, p: GitHubProfile, isAdmin: boolean): Promise<UserRow> {
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `INSERT INTO users (github_id, login, avatar_url, github_name, github_email, is_admin, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       ON CONFLICT (github_id) DO UPDATE SET login = ?2, avatar_url = ?3, github_name = ?4, github_email = ?5,
         is_admin = ?6, updated_at = ?7
       RETURNING *`,
    )
    .bind(p.id, p.login, p.avatarUrl, p.name, p.email, isAdmin ? 1 : 0, now)
    .first<UserRow>();
  if (!row) throw new Error("upsert returned no row");
  return row;
}

export const getUser = (db: D1Database, id: number) => db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();

export const saveAnswers = (db: D1Database, id: number, answers: Answers) =>
  db.prepare("UPDATE users SET answers = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(answers), new Date().toISOString(), id).run();

/** 1-based place among people still waiting who finished the questionnaire, by sign-up order. */
export async function waitlistPosition(db: D1Database, id: number): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'waitlisted' AND answers IS NOT NULL AND id <= ?")
    .bind(id)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export async function waitlistCount(db: D1Database): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'waitlisted' AND answers IS NOT NULL").first<{ n: number }>();
  return r?.n ?? 0;
}

export async function statusCounts(db: D1Database): Promise<Record<Status, number>> {
  const { results } = await db.prepare("SELECT status, COUNT(*) AS n FROM users GROUP BY status").all<{ status: Status; n: number }>();
  const counts = { waitlisted: 0, invited: 0, active: 0, rejected: 0 };
  for (const r of results) counts[r.status] = r.n;
  return counts;
}

export interface Filters {
  q: string;
  status: string;
  contribution: string;
  hardware: string;
}

export function readFilters(url: URL): Filters {
  const pick = (name: string, allowed: readonly string[]) => {
    const v = url.searchParams.get(name) ?? "";
    return allowed.includes(v) ? v : "";
  };
  return {
    q: (url.searchParams.get("q") ?? "").trim().slice(0, 100),
    status: pick("status", STATUSES),
    contribution: pick("contribution", Object.keys(CONTRIBUTIONS)),
    hardware: pick("hardware", [...Object.keys(HARDWARE), "none"]),
  };
}

export async function listUsers(db: D1Database, f: Filters): Promise<UserRow[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
    where.push("(login LIKE ? ESCAPE '\\' OR answers LIKE ? ESCAPE '\\')");
    args.push(like, like);
  }
  if (f.status) {
    where.push("status = ?");
    args.push(f.status);
  }
  if (f.contribution) {
    where.push("EXISTS (SELECT 1 FROM json_each(answers, '$.contributions') WHERE value = ?)");
    args.push(f.contribution);
  }
  if (f.hardware === "none") where.push("json_extract(answers, '$.noHardware') = 1");
  else if (f.hardware) {
    where.push("json_extract(answers, ?) > 0");
    args.push(`$.hardware.${f.hardware}`);
  }
  const sql = `SELECT * FROM users ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT 1000`;
  return (await db.prepare(sql).bind(...args).all<UserRow>()).results;
}

export async function setStatus(db: D1Database, actor: string, user: UserRow, to: Status): Promise<void> {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?").bind(to, now, user.id),
    db
      .prepare("INSERT INTO audit (at, actor_login, user_id, user_login, action, from_status, to_status) VALUES (?, ?, ?, ?, 'status', ?, ?)")
      .bind(now, actor, user.id, user.login, user.status, to),
  ]);
}

export interface AuditRow {
  id: number;
  at: string;
  actor_login: string;
  user_id: number;
  user_login: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
}

export const listAudit = async (db: D1Database) =>
  (await db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 500").all<AuditRow>()).results;

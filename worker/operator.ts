// Operator Console (/admin): Review Queue (the waitlist), Audit, and planned tabs.
import { STATUSES, parseAnswers, type AuditRow, type Filters, type Status, type UserRow } from "./db";
import { empty, esc, page, tabs, type Viewer } from "./html";
import { answersList } from "./member";
import { CONTRIBUTIONS, HARDWARE, type Answers } from "./questionnaire";

export const OPERATOR_TABS = [
  { href: "/admin", label: "Operations" },
  { href: "/admin/training", label: "Training" },
  { href: "/admin/network", label: "Network" },
  { href: "/admin/security", label: "Security" },
  { href: "/admin/review", label: "Review Queue" },
  { href: "/admin/audit", label: "Audit" },
];

export const PLANNED_OPERATOR_TABS: Record<string, [string, string]> = {
  "/admin": ["Coming with the training network", "Node health, job queues and incidents will show here once nodes run."],
  "/admin/training": ["Coming with Run 0", "Runs, losses and checkpoints will show here once training starts."],
  "/admin/network": ["Coming with the peer network", "Peers, relays and bootstrap nodes will show here once the network exists."],
  "/admin/security": ["Coming with signed device identity", "Device keys, revocations and verification sampling will show here."],
};

function shell(v: Viewer, current: string, body: string): string {
  return page(
    "Operator Console",
    v,
    `<header class="app-head"><p class="eyebrow">Operator Console</p><h1>Operations.</h1></header>
${tabs(OPERATOR_TABS, current, "Operator Console")}
${body}`,
  );
}

export function plannedOperatorPage(v: Viewer, current: string): string {
  const [title, note] = PLANNED_OPERATOR_TABS[current] ?? ["", ""];
  return shell(v, current, empty(title, note));
}

const options = (entries: [string, string][], selected: string, all: string) =>
  [["", all], ...entries].map(([k, l]) => `<option value="${esc(k)}"${k === selected ? " selected" : ""}>${esc(l)}</option>`).join("");

const query = (f: Filters) => new URLSearchParams(Object.entries(f).filter(([, val]) => val)).toString();

const contributes = (a: Answers | null) => (a ? a.contributions.map((c) => CONTRIBUTIONS[c]).join(", ") : "");
const hardwareOf = (a: Answers | null) =>
  !a ? "" : a.noHardware ? "None" : Object.entries(a.hardware).map(([k, n]) => `${HARDWARE[k as keyof typeof HARDWARE]} x${n}`).join(", ");

export function reviewPage(v: Viewer, rows: UserRow[], counts: Record<Status, number>, f: Filters): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const stats = [["", "All", total] as const, ...STATUSES.map((s) => [s, s, counts[s]] as const)]
    .map(([s, label, n]) => `<li><a class="app-count${f.status === s ? " app-count-on" : ""}" href="/admin/review${s ? `?status=${s}` : ""}"><b>${n}</b><span>${esc(label)}</span></a></li>`)
    .join("");
  const body = rows
    .map((u) => {
      const a = parseAnswers(u);
      return `<tr><td>${u.id}</td><td><a class="app-link" href="/admin/review/${u.id}">${esc(u.login)}</a></td><td>${esc(a?.displayName ?? "")}</td><td>${esc(a?.email ?? "")}</td><td>${esc(contributes(a))}</td><td>${esc(hardwareOf(a))}</td><td><span class="pill pill-${u.status}">${u.status}</span></td><td>${esc(u.created_at.slice(0, 10))}</td></tr>`;
    })
    .join("");
  return shell(
    v,
    "/admin/review",
    `<ul class="app-counts">${stats}</ul>
<form class="app-filters" method="get" action="/admin/review">
<input class="input" type="search" name="q" value="${esc(f.q)}" placeholder="Search login, name, email, answers" aria-label="Search">
<select class="input" name="status" aria-label="Status">${options(STATUSES.map((s) => [s, s]), f.status, "Any status")}</select>
<select class="input" name="contribution" aria-label="Contribution">${options(Object.entries(CONTRIBUTIONS), f.contribution, "Any contribution")}</select>
<select class="input" name="hardware" aria-label="Hardware">${options([...Object.entries(HARDWARE), ["none", "None"]], f.hardware, "Any hardware")}</select>
<button class="btn btn-sm" type="submit">Filter</button>
<a class="btn btn-sm" href="/admin/review.csv${query(f) ? `?${query(f)}` : ""}">Export CSV</a>
</form>
<div class="app-table-wrap"><table class="app-table">
<thead><tr><th>#</th><th>GitHub</th><th>Name</th><th>Email</th><th>Contributes</th><th>Hardware</th><th>Status</th><th>Signed up</th></tr></thead>
<tbody>${body || '<tr><td colspan="8" class="muted">No sign-ups match.</td></tr>'}</tbody>
</table></div>`,
  );
}

export function detailPage(v: Viewer, u: UserRow): string {
  const a = parseAnswers(u);
  const buttons = STATUSES.filter((s) => s !== u.status)
    .map((s) => `<button class="btn btn-sm" type="submit" name="status" value="${s}">Mark ${s}</button>`)
    .join("");
  return shell(
    v,
    "/admin/review",
    `<p><a class="more" href="/admin/review">Back to the Review Queue</a></p>
<section class="gcard">
<div class="app-who">${u.avatar_url ? `<img class="app-avatar" src="${esc(u.avatar_url)}&amp;s=64" width="40" height="40" alt="">` : ""}<h2 class="app-h2"><a class="app-link" href="https://github.com/${esc(u.login)}" rel="noopener">${esc(u.login)}</a></h2><span class="pill pill-${u.status}">${u.status}</span></div>
<p class="muted">GitHub id ${u.github_id}. Signed up ${esc(u.created_at)}. Updated ${esc(u.updated_at)}.</p>
<form class="app-actions" method="post" action="/admin/review/${u.id}/status">${buttons}</form>
${a ? answersList(a) : '<p class="muted">Questionnaire not filled in yet.</p>'}
</section>`,
  );
}

export function auditPage(v: Viewer, rows: AuditRow[]): string {
  const body = rows
    .map((r) => `<tr><td>${esc(r.at.replace("T", " ").slice(0, 19))}</td><td>${esc(r.actor_login)}</td><td>${esc(r.action)}</td><td><a class="app-link" href="/admin/review/${r.user_id}">${esc(r.user_login)}</a></td><td>${esc(r.from_status ?? "")} to ${esc(r.to_status ?? "")}</td></tr>`)
    .join("");
  return shell(
    v,
    "/admin/audit",
    `<div class="app-table-wrap"><table class="app-table"><thead><tr><th>When (UTC)</th><th>Who</th><th>Action</th><th>Sign-up</th><th>Change</th></tr></thead>
<tbody>${body || '<tr><td colspan="5" class="muted">No operator actions yet.</td></tr>'}</tbody></table></div>`,
  );
}

const cell = (value: unknown) => {
  const s = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export function csv(rows: UserRow[]): string {
  const head = ["id", "github_id", "login", "status", "created_at", "display_name", "email", "location", "contributions", "hardware", "gpu_details", "hours_per_week", "experience", "links", "why", "heard_from", "consent"];
  const lines = rows.map((u) => {
    const a = parseAnswers(u);
    return [u.id, u.github_id, u.login, u.status, u.created_at, a?.displayName, a?.email, a?.location, a?.contributions.join(" "), hardwareOf(a), a?.gpuDetails, a?.hoursPerWeek, a?.experience, a?.links.join(" "), a?.why, a?.heardFrom, a ? (a.consent ? "yes" : "no") : ""]
      .map(cell)
      .join(",");
  });
  return `${[head.join(","), ...lines].join("\r\n")}\r\n`;
}

// The signed-in workspace (/console): app shell and the components its pages share. No scripts:
// selection, tabs and filters are links; charts are SVG drawn on the server from real values.
import { ASSET } from "./assets.gen";
import type { AuditRow, UserRow } from "./db";
import { brandPicture, documentHtml, esc, type Viewer } from "./html";
import { DOCS_URL } from "./program";
import type { Answers } from "./questionnaire";

export const DISCORD_URL = "https://discord.gg/M4sD8T5M8D";

/** Everything a workspace page can show: the person's own row and answers, plus where they stand. */
export interface WorkspaceData {
  v: Viewer;
  user: UserRow;
  answers: Answers;
  /** 1-based waitlist place; 0 when not waitlisted. */
  position: number;
  waiting: number;
  events: AuditRow[];
  now: Date;
}

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export const WORKSPACE_NAV: NavItem[] = [
  { href: "/console", label: "Overview", icon: "w-grid" },
  { href: "/console/nodes", label: "Compute Nodes", icon: "w-server" },
  { href: "/console/runs", label: "Training Runs", icon: "w-play" },
  { href: "/console/models", label: "Model Registry", icon: "w-diamond" },
  { href: "/console/contributions", label: "Contributions", icon: "w-ledger" },
];
const SETTINGS: NavItem = { href: "/console/profile", label: "Settings", icon: "w-gear" };

export const icon = (id: string, cls = "") => `<svg${cls ? ` class="${cls}"` : ""} aria-hidden="true"><use href="#${id}"/></svg>`;

export type Tone = "live" | "idle" | "warn" | "plan";
export const badge = (label: string, tone: Tone) => `<span class="ws-badge ws-${tone}">${esc(label)}</span>`;

export interface Kpi {
  label: string;
  value: string;
  note: string;
  href?: string;
  /** A short highlighted fact on the right of the note, e.g. "Run 0 forming". */
  flag?: string;
}

export function kpis(list: Kpi[]): string {
  const item = (k: Kpi) => {
    const inner = `<span class="ws-kpi-label">${esc(k.label)}</span>${k.href ? icon("w-ext", "ws-kpi-go") : ""}<b>${esc(k.value)}</b><span class="ws-kpi-note"><span>${esc(k.note)}</span>${k.flag ? `<em>${esc(k.flag)}</em>` : ""}</span>`;
    return `<li>${k.href ? `<a class="ws-kpi" href="${k.href}">${inner}</a>` : `<div class="ws-kpi">${inner}</div>`}</li>`;
  };
  return `<ul class="ws-kpis">${list.map(item).join("")}</ul>`;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const panel = (title: string, aside: string, body: string, cls = "") =>
  `<section class="ws-panel${cls ? ` ${cls}` : ""}" aria-labelledby="p-${slug(title)}"><header><h2 id="p-${slug(title)}">${esc(title)}</h2>${aside}</header>${body}</section>`;

export const more = (href: string, label: string) =>
  `<a class="ws-more" href="${href}"${href.startsWith("http") ? ' rel="noopener"' : ""}>${esc(label)}${icon(href.startsWith("http") ? "w-ext" : "w-arr")}</a>`;

export const progress = (pct: number, label: string) =>
  `<span class="ws-progress"><progress max="100" value="${pct}" aria-label="${esc(label)}">${pct}%</progress><b>${pct}%</b></span>`;

export const DAY_MS = 86_400_000;
const shortDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).toUpperCase();

/**
 * Daily values for the 30 days ending `end`, as an area chart. The y scale never invents a range:
 * with all zeros the line sits on the axis and the chart says so.
 */
export function dailyChart(values: number[], end: Date, unit: string, emptyNote: string): string {
  const w = 720;
  const top = 18;
  const base = 176;
  const max = Math.max(...values, 0);
  const x = (i: number) => Math.round((i / (values.length - 1)) * w);
  const y = (v: number) => (max === 0 ? base : Math.round(base - (v / max) * (base - top)));
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(v)}`).join(" ");
  const grid = [0, 1, 2, 3].map((g) => `<line x1="0" x2="${w}" y1="${top + g * ((base - top) / 3)}" y2="${top + g * ((base - top) / 3)}"/>`).join("");
  const ticks = [0, 9, 19, values.length - 1]
    .map((i) => `<span>${shortDate(new Date(end.getTime() - (values.length - 1 - i) * DAY_MS))}</span>`)
    .join("");
  const total = values.reduce((a, b) => a + b, 0);
  const label = total === 0 ? `${unit} per day for the last 30 days: zero on every day` : `${unit} per day for the last 30 days, ${total} in total`;
  return `<figure class="ws-chart">
<svg viewBox="0 0 ${w} 200" role="img" aria-label="${esc(label)}"><g class="ws-gridlines">${grid}</g><path class="ws-area" d="${line} L${w} ${base} L0 ${base} Z"/><path class="ws-line" d="${line}" pathLength="1"/><circle class="ws-dot" cx="${w}" cy="${y(values.at(-1) ?? 0)}" r="5"/></svg>
<figcaption>${ticks}</figcaption>
${total === 0 ? `<p class="ws-chart-empty">${esc(emptyNote)}</p>` : ""}
</figure>`;
}

export interface Slice {
  label: string;
  value: number;
}

/** Share donut in SVG (stroke-dasharray on a circle of circumference 100), no inline styles. */
export function donut(slices: Slice[], centre: string, caption: string): string {
  const total = slices.reduce((a, s) => a + s.value, 0);
  let offset = 0;
  const arcs =
    total === 0
      ? ""
      : slices
          .map((s, i) => {
            const pct = (s.value / total) * 100;
            const arc = `<circle class="ws-seg ws-seg-${i + 1}" r="15.915" cx="21" cy="21" pathLength="100" stroke-dasharray="${pct.toFixed(2)} ${(100 - pct).toFixed(2)}" stroke-dashoffset="${(25 - offset).toFixed(2)}"/>`;
            offset += pct;
            return arc;
          })
          .join("");
  const legend = slices
    .map((s, i) => `<li><i class="ws-sw ws-seg-${i + 1}" aria-hidden="true"></i>${esc(s.label)}<b>${total === 0 ? "0%" : `${Math.round((s.value / total) * 100)}%`}</b></li>`)
    .join("");
  return `<div class="ws-donut"><div class="ws-donut-art"><svg viewBox="0 0 42 42" role="img" aria-label="${esc(caption)}"><circle class="ws-seg-track" r="15.915" cx="21" cy="21"/>${arcs}</svg><p>${centre}</p></div><ul class="ws-legend">${legend}</ul></div>`;
}

export function ago(at: string, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - Date.parse(at)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return at.slice(0, 10);
}

export interface Head {
  eyebrow: string;
  title: string;
  lede: string;
  actions: string;
}

function side(d: WorkspaceData, current: string): string {
  const link = (n: NavItem) =>
    `<a href="${n.href}"${n.href === current ? ' aria-current="page"' : ""}>${icon(n.icon)}<span>${esc(n.label)}</span></a>`;
  const ext = (href: string, label: string, id: string) => `<a href="${href}" rel="noopener">${icon(id)}<span>${esc(label)}</span>${icon("w-ext", "ws-ext")}</a>`;
  const avatar = d.v.avatarUrl
    ? `<img src="${esc(d.v.avatarUrl)}&amp;s=80" width="40" height="40" alt="">`
    : `<span>${esc(d.v.login.slice(0, 2).toUpperCase())}</span>`;
  const standing = d.user.status === "waitlisted" && d.position > 0 ? `Waitlist #${d.position}` : `Status: ${d.user.status}`;
  return `<aside class="ws-side">
<a class="ws-brand" href="/">${brandPicture("ws-logo")}<span><b>Open<br>Frontier<br>Labs</b><small>Open training network</small></span></a>
<nav class="ws-nav" aria-label="Workspace">
<p>Workspace</p>
${WORKSPACE_NAV.map(link).join("\n")}
<p>Resources</p>
${ext(DISCORD_URL, "Community", "w-people")}
${ext(DOCS_URL, "Documentation", "w-book")}
${link(SETTINGS)}
</nav>
<div class="ws-net" role="status"><i aria-hidden="true"></i><span><b>Run 0 is forming</b><small>No node connected · Node app planned</small></span></div>
<a class="ws-me" href="/console/profile"><span class="ws-avatar">${avatar}</span><span><b>${esc(d.answers.displayName || d.v.login)}</b><small>@${esc(d.v.login)} · ${esc(standing)}</small></span></a>
</aside>`;
}

function top(d: WorkspaceData, title: string): string {
  return `<header class="ws-top">
<nav class="ws-crumbs" aria-label="Breadcrumb"><a href="/console">Workspace</a><span aria-hidden="true">/</span><span aria-current="page">${esc(title)}</span></nav>
<form class="ws-search" action="https://github.com/OpenFrontierLabs/openfrontier/search" method="get" role="search">${icon("w-search")}<label class="sr-only" for="ws-q">Search the openfrontier repository on GitHub</label><input id="ws-q" name="q" type="search" placeholder="Search runs, configs and docs on GitHub" autocomplete="off"><kbd>Enter</kbd></form>
${d.v.isAdmin ? '<a class="ws-icon-btn ws-op" href="/admin">Operator</a>' : ""}
<form method="post" action="/logout"><button class="ws-icon-btn" type="submit" title="Sign out">${icon("w-out")}<span class="sr-only">Sign out</span></button></form>
</header>`;
}

export function workspacePage(d: WorkspaceData, current: string, head: Head, body: string): string {
  return documentHtml(
    head.title,
    `${ASSET.wsSprite}
<a href="#main" class="ws-skip">Skip to content</a>
<div class="ws">
${side(d, current)}
<div class="ws-body">
${top(d, head.title)}
<main id="main" class="ws-main">
<header class="ws-head"><div><p class="ws-eyebrow">${esc(head.eyebrow)}</p><h1>${esc(head.title)}</h1><p>${esc(head.lede)}</p></div><div class="ws-actions">${head.actions}</div></header>
${body}
<p class="ws-foot">Live data: your sign-up from our database, the program from the openfrontier repository. A zero is a real zero; Run 0 has not started.</p>
</main>
</div>
</div>`,
    { bodyClass: "ws-page", styles: [ASSET.css, ASSET.wsCss] },
  );
}

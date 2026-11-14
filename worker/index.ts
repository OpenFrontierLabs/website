import * as Sentry from "@sentry/cloudflare";
// Worker for openfrontier-labs.com: static assets plus GitHub sign-up, the waitlist questionnaire,
// the signed-in workspace (/console) and the Operator Console (/admin). Everything else is assets.
import * as db from "./db";
import { exchangeCode, fetchProfile, isOperator, SCOPE } from "./github";
import { esc } from "./esc";
import { html, SECURITY_HEADERS, toGitHub, type Viewer } from "./html";
import * as member from "./member";
import * as operator from "./operator";
import * as swarm from "./swarm";
import * as swarmView from "./swarm-view";
import * as pages from "./workspace-pages";
import type { WorkspaceData } from "./workspace";
import { validateAnswers, type Answers } from "./questionnaire";
import { cookies, randomToken, readSession, sign, SESSION_TTL, setCookie, signSession, STATE_TTL, stateMatches } from "./signing";
import { secretMatches, sentryOptions } from "./sentry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  APP_ORIGIN: string;
  /** Unset until the OpenFrontierLabs OAuth App exists; sign-in then fails closed with 503. */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET: string;
  ADMIN_GITHUB_LOGINS: string;
  /** Bearer token of the swarm coordinator. Unset until `wrangler secret put SWARM_INGEST_TOKEN`; ingest then fails closed with 503. */
  SWARM_INGEST_TOKEN?: string;
  /** Sentry DSN (`wrangler secret put SENTRY_DSN`); unset disables Sentry reporting. */
  SENTRY_DSN?: string;
  /** Git short SHA injected at deploy via `--var SENTRY_RELEASE:<sha>`. */
  SENTRY_RELEASE?: string;
  /** Header secret for the hidden `/__sentry-test` probe (`wrangler secret put SENTRY_TEST_KEY`). */
  SENTRY_TEST_KEY?: string;
}

const SESSION = "__Host-ofl_session";
const STATE = "__Host-ofl_state";
const WAITLIST_CACHE_SECONDS = 300;

const STATE_ERROR = "That sign-in link expired or was opened in another browser. Try again.";
const GITHUB_ERROR = "GitHub sign-in did not complete. Try again.";
const NOT_CONFIGURED = "GitHub sign-in is not switched on yet. Please try again later.";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...SECURITY_HEADERS } });

interface Ctx {
  env: Env;
  req: Request;
  url: URL;
  user: db.UserRow | null;
}

const viewerOf = (u: db.UserRow): Viewer => ({ login: u.login, avatarUrl: u.avatar_url, isAdmin: u.is_admin === 1 });

/** Where a signed-in person lands: the questionnaire until they have answered it, then the Overview
 * (with a thank-you right after the questionnaire). */
async function landing(c: Ctx, user: db.UserRow, setCookies: string[] = [], thanks = false): Promise<Response> {
  const v = viewerOf(user);
  const answers = db.parseAnswers(user);
  if (!answers) return html(member.questionnairePage(v, member.prefill(user), {}), 200, setCookies);
  return html(pages.overview(await workspaceData(c, user, answers), thanks), 200, setCookies);
}

async function workspaceData(c: Ctx, user: db.UserRow, answers: Answers): Promise<WorkspaceData> {
  const now = new Date();
  const [standing, memberSwarm] = await Promise.all([db.standing(c.env.DB, user), swarm.memberSwarm(c.env.DB, user.login, now)]);
  return { v: viewerOf(user), user, answers, ...standing, swarm: memberSwarm, now };
}

async function home(c: Ctx, ctx: ExecutionContext): Promise<Response> {
  const res = await c.env.ASSETS.fetch(c.req);
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  const key = new Request(`${c.url.origin}/__waitlist-count`);
  const cache = caches.default;
  let count = (await cache.match(key))?.headers.get("x-count") ?? null;
  if (count === null) {
    try {
      count = String(await db.waitlistCount(c.env.DB));
    } catch (err) {
      // The count is an optional stat: serve the page without it rather than fail the home page.
      console.error(err);
      return res;
    }
    ctx.waitUntil(cache.put(key, new Response(null, { headers: { "x-count": count, "cache-control": `max-age=${WAITLIST_CACHE_SECONDS}` } })));
  }
  const value = count;
  return new HTMLRewriter().on("[data-waitlist]", { element: (el) => void el.setInnerContent(`, ${value} on the waitlist`) }).transform(res);
}

const json = (body: unknown, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body), { status, headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": cache } });

const bearerMatches = (header: string | null, secret: string) =>
  secretMatches(header?.startsWith("Bearer ") ? header.slice(7) : "", secret);
async function swarmIngest(c: Ctx): Promise<Response> {
  if (!c.env.SWARM_INGEST_TOKEN) return json({ error: "swarm ingest is not configured" }, 503);
  if (!(await bearerMatches(c.req.headers.get("authorization"), c.env.SWARM_INGEST_TOKEN))) return json({ error: "unauthorized" }, 401);
  let report;
  try {
    report = swarm.parseReport(await c.req.json(), Date.now());
  } catch (err) {
    if (err instanceof swarm.BadReport || err instanceof SyntaxError) return json({ error: err.message }, 400);
    throw err;
  }
  await swarm.ingest(c.env.DB, report);
  return json({ ok: true });
}

/** The dashboard is a static asset whose swarm blocks are filled from D1 on each view; without data (or if D1 fails) the static zeros stand. */
async function dashboard(c: Ctx): Promise<Response> {
  const res = await c.env.ASSETS.fetch(c.req);
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  let s: swarm.Summary;
  try {
    s = await swarm.summary(c.env.DB);
  } catch (err) {
    console.error(err);
    return res;
  }
  const inner = (html: string) => ({ element: (el: Element) => void el.setInnerContent(html, { html: true }) });
  const rewriter = new HTMLRewriter()
    .on('li[data-swarm="nodes"]', { element: (el) => void el.replace(swarmView.nodesStat(s), { html: true }) })
    .on('li[data-swarm="runs"]', { element: (el) => void el.replace(swarmView.runsStat(s), { html: true }) })
    .on('section[data-swarm="util"]', inner(swarmView.devicesCard(s)))
    .on('section[data-swarm="mine"]', inner(swarmView.computeCard(s)))
    .on('ul[data-swarm="map"]', inner(swarmView.mapStats(s)))
    .on('p[data-swarm="mapnote"]', inner(esc(swarmView.mapNote(s))));
  if (s.latest_run) rewriter.on('section[data-swarm="run"]', inner(swarmView.runCard(s)));
  const out = new Response(rewriter.transform(res).body, res);
  out.headers.set("cache-control", "public, max-age=10");
  return out;
}

async function startOAuth(c: Ctx): Promise<Response> {
  if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) return html(member.joinPage(NOT_CONFIGURED, c.env.APP_ORIGIN, false), 503);
  const state = randomToken();
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.search = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: `${c.env.APP_ORIGIN}/auth/github/callback`,
    scope: SCOPE,
    state,
    allow_signup: "true",
  }).toString();
  return toGitHub(authorize, [setCookie(STATE, await sign({ state }, c.env.SESSION_SECRET, STATE_TTL), STATE_TTL)]);
}

async function finishOAuth(c: Ctx): Promise<Response> {
  const clearState = setCookie(STATE, "", 0);
  const ok = await stateMatches(cookies(c.req.headers.get("cookie")).get(STATE), c.url.searchParams.get("state"), c.env.SESSION_SECRET);
  if (!ok) return html(member.joinPage(STATE_ERROR, c.env.APP_ORIGIN), 400, [clearState]);
  const code = c.url.searchParams.get("code");
  if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) return html(member.joinPage(NOT_CONFIGURED, c.env.APP_ORIGIN, false), 503, [clearState]);
  if (!code) return html(member.joinPage(GITHUB_ERROR, c.env.APP_ORIGIN), 400, [clearState]);
  let profile;
  try {
    const token = await exchangeCode(code, c.env.GITHUB_CLIENT_ID, c.env.GITHUB_CLIENT_SECRET, `${c.env.APP_ORIGIN}/auth/github/callback`);
    profile = await fetchProfile(token);
  } catch (err) {
    console.error(err);
    return html(member.joinPage(GITHUB_ERROR, c.env.APP_ORIGIN), 502, [clearState]);
  }
  const user = await db.upsertUser(c.env.DB, profile, isOperator(profile.login, profile.orgRole, c.env.ADMIN_GITHUB_LOGINS));
  const session = await signSession({ uid: user.id, login: user.login }, c.env.SESSION_SECRET);
  return landing(c, user, [clearState, setCookie(SESSION, session, SESSION_TTL)]);
}

/** Validates and saves; on success renders `done` with the saved row, on failure re-renders the form. */
async function saveQuestionnaire(c: Ctx, user: db.UserRow, render: (errors: Record<string, string>, answers: Answers) => string, done: (saved: db.UserRow) => Promise<Response>): Promise<Response> {
  const { answers, errors } = validateAnswers(await c.req.formData());
  if (Object.keys(errors).length > 0) return html(render(errors, answers), 422);
  await db.saveAnswers(c.env.DB, user.id, answers);
  return done({ ...user, answers: JSON.stringify(answers) });
}

async function memberRoutes(c: Ctx, user: db.UserRow): Promise<Response> {
  const v = viewerOf(user);
  const { pathname } = c.url;
  const answers = db.parseAnswers(user);
  if (pathname === "/join/questionnaire") {
    if (c.req.method === "POST") return saveQuestionnaire(c, user, (e, a) => member.questionnairePage(v, a, e), (saved) => landing(c, saved, [], true));
    return answers ? html(pages.settings(await workspaceData(c, user, answers), answers, {}, false)) : landing(c, user);
  }
  if (!answers) return landing(c, user);
  const d = await workspaceData(c, user, answers);
  const q = c.url.searchParams;
  switch (pathname) {
    case "/console":
      return html(pages.overview(d));
    case "/console/nodes":
      return html(pages.nodes(d, q.get("device")));
    case "/console/runs":
      return html(pages.runs(d));
    case "/console/models":
      return html(pages.models(d, q.get("tab")));
    case "/console/contributions":
      return html(pages.contributions(d));
    case "/console/profile":
      if (c.req.method === "POST") {
        return saveQuestionnaire(c, user, (e, a) => pages.settings(d, a, e, false), async (saved) => {
          const now = db.parseAnswers(saved) ?? answers;
          return html(pages.settings({ ...d, user: saved, answers: now }, now, {}, true));
        });
      }
      return html(pages.settings(d, answers, {}, false));
    default:
      return text("Not found", 404);
  }
}

async function operatorRoutes(c: Ctx, user: db.UserRow): Promise<Response> {
  const v = viewerOf(user);
  const { pathname } = c.url;
  if (pathname in operator.PLANNED_OPERATOR_TABS) return html(operator.plannedOperatorPage(v, pathname));
  if (pathname === "/admin/review") {
    const f = db.readFilters(c.url);
    const [rows, counts] = await Promise.all([db.listUsers(c.env.DB, f), db.statusCounts(c.env.DB)]);
    return html(operator.reviewPage(v, rows, counts, f));
  }
  if (pathname === "/admin/review.csv") {
    const rows = await db.listUsers(c.env.DB, db.readFilters(c.url));
    return new Response(operator.csv(rows), {
      headers: { ...SECURITY_HEADERS, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="ofl-waitlist-${new Date().toISOString().slice(0, 10)}.csv"` },
    });
  }
  if (pathname === "/admin/audit") return html(operator.auditPage(v, await db.listAudit(c.env.DB)));
  const m = /^\/admin\/review\/(\d+)(\/status)?$/.exec(pathname);
  const target = m ? await db.getUser(c.env.DB, Number(m[1])) : null;
  if (!m || !target) return text("Not found", 404);
  if (!m[2]) return html(operator.detailPage(v, target));
  if (c.req.method !== "POST") return text("Method not allowed", 405);
  const to = (await c.req.formData()).get("status");
  if (typeof to !== "string" || !(db.STATUSES as readonly string[]).includes(to)) return text("Unknown status", 400);
  if (to !== target.status) await db.setStatus(c.env.DB, user.login, target, to as db.Status);
  return html(operator.detailPage(v, { ...target, status: to as db.Status }));
}

/** POSTs must come from our own pages (SameSite=Lax already blocks cross-site cookies; this is the second lock).
 * Sec-Fetch-Site is checked first because Chrome sends `Origin: null` on form POSTs when the page's referrer policy is strict. */
const sameOrigin = (req: Request, url: URL) => {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  return req.headers.get("origin") === url.origin;
};

async function route(c: Ctx, ctx: ExecutionContext): Promise<Response> {
  const { pathname } = c.url;
  if (pathname === "/__sentry-test") {
    const key = c.env.SENTRY_TEST_KEY ?? "";
    const given = c.req.headers.get("x-sentry-test") ?? "";
    if (key.length > 0 && given.length > 0 && (await secretMatches(given, key))) throw new Error("ofl sentry test");
    return c.env.ASSETS.fetch(c.req);
  }
  if (pathname === "/v1/swarm/ingest") return c.req.method === "POST" ? swarmIngest(c) : text("Method not allowed", 405);
  if (pathname === "/v1/swarm") return c.req.method === "GET" ? json(await swarm.summary(c.env.DB), 200, "public, max-age=5") : text("Method not allowed", 405);
  if (pathname === "/dashboard") return dashboard(c);
  if (c.req.method === "POST" && !sameOrigin(c.req, c.url)) return text("Cross-origin request refused", 403);
  if (pathname === "/") return home(c, ctx);
  if (pathname === "/auth/github") return startOAuth(c);
  if (pathname === "/auth/github/callback") return finishOAuth(c);
  if (pathname === "/logout") return c.req.method === "POST" ? html(member.signedOutPage(), 200, [setCookie(SESSION, "", 0)]) : text("Method not allowed", 405);
  if (pathname === "/join") return c.user ? landing(c, c.user) : html(member.joinPage(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET ? null : NOT_CONFIGURED, c.env.APP_ORIGIN, Boolean(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET)));
  const isOperatorPath = pathname === "/admin" || pathname.startsWith("/admin/");
  const isMemberPath = pathname === "/join/questionnaire" || pathname === "/console" || pathname.startsWith("/console/");
  if (!isOperatorPath && !isMemberPath) return c.env.ASSETS.fetch(c.req);
  if (isMemberPath) return c.user ? memberRoutes(c, c.user) : html(member.joinPage(null, c.env.APP_ORIGIN), 401);
  if (c.user?.is_admin !== 1) return html(member.forbiddenPage(c.user ? viewerOf(c.user) : null, c.env.APP_ORIGIN), 403);
  return operatorRoutes(c, c.user);
}

const handler: ExportedHandler<Env> = {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    const session = await readSession(cookies(req.headers.get("cookie")).get(SESSION), env.SESSION_SECRET);
    const user = session ? await db.getUser(env.DB, session.uid) : null;
    return route({ env, req, url, user }, ctx);
  },
};

export default Sentry.withSentry((env: Env) => sentryOptions(env), handler);

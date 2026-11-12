// Worker for openfrontier-labs.com: static assets plus GitHub sign-up, the waitlist questionnaire,
// the Member Console (/console) and the Operator Console (/admin). Everything else is assets.
import * as db from "./db";
import { exchangeCode, fetchProfile, isOperator, SCOPE } from "./github";
import { html, SECURITY_HEADERS, toGitHub, type Viewer } from "./html";
import * as member from "./member";
import * as operator from "./operator";
import { validateAnswers, type Answers } from "./questionnaire";
import { cookies, randomToken, readSession, sign, SESSION_TTL, setCookie, signSession, STATE_TTL, stateMatches } from "./signing";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  APP_ORIGIN: string;
  /** Unset until the OpenFrontierLabs OAuth App exists; sign-in then fails closed with 503. */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET: string;
  ADMIN_GITHUB_LOGINS: string;
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
 * (with a thank-you and matched starter issues right after the questionnaire). */
async function landing(c: Ctx, user: db.UserRow, setCookies: string[] = [], thanks = false): Promise<Response> {
  const v = viewerOf(user);
  const answers = db.parseAnswers(user);
  if (!answers) return html(member.questionnairePage(v, member.prefill(user), {}), 200, setCookies);
  return html(member.overviewPage(v, user, await db.waitlistPosition(c.env.DB, user.id), answers, thanks), 200, setCookies);
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
    return answers ? html(member.profilePage(v, answers, {}, false)) : landing(c, user);
  }
  if (!answers) return landing(c, user);
  if (pathname === "/console") return html(member.overviewPage(v, user, await db.waitlistPosition(c.env.DB, user.id), answers));
  if (pathname === "/console/profile") {
    if (c.req.method === "POST") {
      return saveQuestionnaire(c, user, (e, a) => member.profilePage(v, a, e, false), async (saved) => html(member.profilePage(v, db.parseAnswers(saved) ?? answers, {}, true)));
    }
    return html(member.profilePage(v, answers, {}, false));
  }
  if (pathname in member.PLANNED_MEMBER_TABS) return html(member.plannedMemberPage(v, pathname));
  return text("Not found", 404);
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

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    const session = await readSession(cookies(req.headers.get("cookie")).get(SESSION), env.SESSION_SECRET);
    const user = session ? await db.getUser(env.DB, session.uid) : null;
    return route({ env, req, url, user }, ctx);
  },
} satisfies ExportedHandler<Env>;

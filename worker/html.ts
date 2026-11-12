// Server-rendered HTML shell for /join, the workspace (/console) and the Operator Console. No scripts.
import { ASSET } from "./assets.gen";
import { esc } from "./esc";

const CSP = [
  "default-src 'none'",
  "img-src 'self' data: https://avatars.githubusercontent.com",
  // Stylesheets are inlined (one render-blocking request fewer); their hashes are the only inline styles allowed.
  `style-src 'self' ${ASSET.cssHash} ${ASSET.wsCssHash}`,
  "font-src 'self'",
  "script-src 'none'",
  "connect-src 'self'",
  "base-uri 'none'",
  // The workspace search goes to GitHub's repository search.
  "form-action 'self' https://github.com",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "cache-control": "no-store",
};

export interface Viewer {
  login: string;
  avatarUrl: string;
  isAdmin: boolean;
}

export interface Tab {
  href: string;
  label: string;
}

export function tabs(list: Tab[], current: string, label: string): string {
  const items = list
    .map((t) => `<a class="app-tab${t.href === current ? " app-tab-on" : ""}" href="${t.href}"${t.href === current ? ' aria-current="page"' : ""}>${esc(t.label)}</a>`)
    .join("");
  return `<nav class="app-tabs" aria-label="${esc(label)}">${items}</nav>`;
}

function account(v: Viewer | null): string {
  if (!v) return "";
  const avatar = v.avatarUrl ? `<img class="app-avatar" src="${esc(v.avatarUrl)}&amp;s=64" width="28" height="28" alt="">` : "";
  return `<div class="app-account">${v.isAdmin ? '<a class="navlink" href="/admin">Operator Console</a>' : ""}<a class="navlink" href="/console">Workspace</a><span class="app-who">${avatar}${esc(v.login)}</span><form method="post" action="/logout"><button class="btn btn-sm" type="submit">Sign out</button></form></div>`;
}

/** A public page (only /join) passes `index`: it is crawlable, described and canonical. Everything else stays noindex. */
export interface PublicMeta {
  description: string;
  canonical: string;
}

/** The document around every Worker page. `styles` are inline stylesheets admitted by hash in the CSP. */
export function documentHtml(title: string, body: string, opts: { index?: PublicMeta; bodyClass?: string; styles?: string[] } = {}): string {
  const meta = opts.index
    ? `<meta name="description" content="${esc(opts.index.description)}">\n<link rel="canonical" href="${esc(opts.index.canonical)}">`
    : '<meta name="robots" content="noindex">';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | Open Frontier Labs</title>
${meta}
<meta name="theme-color" content="#000000">
<meta name="color-scheme" content="dark">
<link rel="icon" href="/favicon.ico" sizes="48x48">
${(opts.styles ?? [ASSET.css]).map((css) => `<style>${css}</style>`).join("\n")}
</head>
<body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ""}>
${body}
</body>
</html>`;
}

export const brandPicture = (cls: string) =>
  `<picture><source srcset="${ASSET.logoAvif}" type="image/avif"><source srcset="${ASSET.logoWebp}" type="image/webp"><img src="${ASSET.logoPng}" width="160" height="74" alt="" class="${cls}"></picture>`;

export function page(title: string, viewer: Viewer | null, body: string, index?: PublicMeta): string {
  return documentHtml(
    title,
    `<header class="nav"><div class="wrap-x flex h-16 items-center justify-between gap-4">
<a href="/" class="brand">${brandPicture("brand-mark")}<span>Open Frontier Labs</span></a>
${account(viewer)}
</div></header>
<main id="main" class="wrap-x app-main">
${body}
</main>`,
    { index },
  );
}

export function html(body: string, status = 200, setCookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", ...SECURITY_HEADERS });
  for (const c of setCookies) headers.append("set-cookie", c);
  return new Response(body, { status, headers });
}

/** The one off-site hop OAuth needs: our pages never redirect to each other. */
export function toGitHub(authorizeUrl: URL, setCookies: string[]): Response {
  const headers = new Headers({ location: authorizeUrl.toString(), "cache-control": "no-store" });
  for (const c of setCookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

export const empty = (title: string, note: string) =>
  `<section class="gcard app-empty"><span class="tag">Planned</span><h2>${esc(title)}</h2><p>${esc(note)}</p></section>`;

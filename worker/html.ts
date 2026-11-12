// Server-rendered HTML shell for /join, the Member Console and the Operator Console. No scripts.
import { ASSET } from "./assets.gen";

export const esc = (s: unknown) =>
  String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const CSP = [
  "default-src 'none'",
  "img-src 'self' data: https://avatars.githubusercontent.com",
  "style-src 'self'",
  "font-src 'self'",
  "script-src 'none'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
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
  return `<div class="app-account">${v.isAdmin ? '<a class="navlink" href="/admin">Operator Console</a>' : ""}<a class="navlink" href="/console">Member Console</a><span class="app-who">${avatar}${esc(v.login)}</span><form method="post" action="/logout"><button class="btn btn-sm" type="submit">Sign out</button></form></div>`;
}

export function page(title: string, viewer: Viewer | null, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | Open Frontier Labs</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#000000">
<meta name="color-scheme" content="dark">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="preload" href="${ASSET.font}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${ASSET.css}">
</head>
<body>
<header class="nav"><div class="wrap-x flex h-16 items-center justify-between gap-4">
<a href="/" class="brand"><picture><source srcset="${ASSET.logoWebp}" type="image/webp"><img src="${ASSET.logoPng}" width="44" height="44" alt="" class="size-10"></picture><span>Open Frontier Labs</span></a>
${account(viewer)}
</div></header>
<main id="main" class="wrap-x app-main">
${body}
</main>
</body>
</html>`;
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

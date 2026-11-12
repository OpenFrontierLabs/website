import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const fontSrc = join(root, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2");

const displaySrc = join(root, "node_modules/@fontsource/michroma/files/michroma-latin-400-normal.woff2");

const hash = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex").slice(0, 10);

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "assets"), { recursive: true });
await cp(join(root, "public"), dist, { recursive: true });

const font = new Uint8Array(await readFile(fontSrc));
const fontName = `inter-${hash(font)}.woff2`;
await writeFile(join(dist, "assets", fontName), font);

const display = new Uint8Array(await readFile(displaySrc));
const displayName = `michroma-${hash(display)}.woff2`;
await writeFile(join(dist, "assets", displayName), display);

// Art (AVIF/WebP/PNG from `bun run assets`) is content-hashed; HTML refers to it as %ART:file%.
const art = new Map<string, string>();
for (const file of await readdir(join(root, "art"))) {
  const data = new Uint8Array(await readFile(join(root, "art", file)));
  const dot = file.lastIndexOf(".");
  const hashed = `${file.slice(0, dot)}-${hash(data)}${file.slice(dot)}`;
  await writeFile(join(dist, "assets", hashed), data);
  art.set(file, `/assets/${hashed}`);
}
const withArt = (html: string) =>
  html.replace(/%ART:([\w.-]+)%/g, (_, file: string) => {
    const url = art.get(file);
    if (!url) throw new Error(`unknown art ${file}`);
    return url;
  });

// Real numbers only: the contributor count and the dashboard's activity feed are read from GitHub at
// build time, and the build fails rather than publish a made-up 0 or an empty feed when GitHub is
// unreachable or rate-limited. GITHUB_TOKEN (optional, env only) lifts the anonymous rate limit.
const token = process.env.GITHUB_TOKEN;
async function github(path: string, accept = "application/vnd.github+json"): Promise<Response> {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      accept,
      "user-agent": "ofl-website-build",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GitHub ${path}: HTTP ${res.status}. Set GITHUB_TOKEN (env) and rebuild.`);
  return res;
}
const contributorsRes = await github("repos/OpenFrontierLabs/openfrontier/contributors?per_page=1&anon=1");
const lastPage = /[?&]page=(\d+)>; rel="last"/.exec(contributorsRes.headers.get("link") ?? "")?.[1];

// The organisation's repositories: the activity feed and the contributors page read all three.
const REPOS = ["openfrontier", "website", ".github"];

// Recent activity: the latest merged pull requests across the organisation's repositories.
interface Pull {
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
}
const escapeHtml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const merged = (
  await Promise.all(
    REPOS.map(async (repo) => {
      const pulls = (await (await github(`repos/OpenFrontierLabs/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=20`)).json()) as Pull[];
      return pulls.filter((p) => p.merged_at !== null).map((p) => ({ ...p, repo, mergedAt: p.merged_at! }));
    }),
  )
)
  .flat()
  .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))
  .slice(0, 6);
if (merged.length === 0) throw new Error("GitHub returned no merged pull requests for the activity feed");
const activity = merged
  .map((p) => {
    const title = escapeHtml(p.title.replace(/\s*\((?:Agent|agent):[^)]*\)\s*$/u, ""));
    const day = new Date(p.mergedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    return `<li><svg class="act-ico" aria-hidden="true"><use href="#i-check"/></svg><a href="${p.html_url}" rel="noopener"><b>${title}</b><span>Merged in ${escapeHtml(p.repo)} #${p.number}</span></a><time datetime="${p.mergedAt}">${day}</time></li>`;
  })
  .join("\n");

// Contributors page (/contributors): everyone with commits in the organisation's repositories, the compute
// ledger and CREDITS.md, all read from GitHub at build time. Avatars are copied into dist so the page stays
// on our own origin under the CSP.
interface GitHubContributor {
  login: string;
  type: string;
  avatar_url: string;
  contributions: number;
}
async function allPages<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const res = await github(`${path}?per_page=100&page=${page}`);
    if (res.status === 204) return out; // an empty repository has no contributors
    out.push(...((await res.json()) as T[]));
    if (!/rel="next"/.test(res.headers.get("link") ?? "")) return out;
  }
}
const people = new Map<string, { login: string; avatarUrl: string; commits: number }>();
for (const list of await Promise.all(REPOS.map((repo) => allPages<GitHubContributor>(`repos/OpenFrontierLabs/${repo}/contributors`)))) {
  for (const c of list) {
    if (c.type !== "User") continue; // bots are not credited
    const person = people.get(c.login) ?? { login: c.login, avatarUrl: c.avatar_url, commits: 0 };
    person.commits += c.contributions;
    people.set(c.login, person);
  }
}
if (people.size === 0) throw new Error("GitHub returned no contributors for the contributors page");
const AVATAR_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
async function avatar(url: string): Promise<string> {
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}s=96`, { signal: AbortSignal.timeout(8000) });
  const ext = AVATAR_TYPES[res.headers.get("content-type") ?? ""];
  if (!res.ok || !ext) throw new Error(`avatar ${url}: HTTP ${res.status} ${res.headers.get("content-type")}`);
  const data = new Uint8Array(await res.arrayBuffer());
  const name = `avatar-${hash(data)}.${ext}`;
  await writeFile(join(dist, "assets", name), data);
  return `/assets/${name}`;
}
const contributors = (
  await Promise.all(
    [...people.values()]
      .sort((a, b) => b.commits - a.commits || a.login.localeCompare(b.login))
      .map(async (p) => {
        const commits = `${p.commits.toLocaleString("en-US")} commit${p.commits === 1 ? "" : "s"}`;
        return `<li><a href="https://github.com/${escapeHtml(p.login)}" rel="noopener"><img src="${await avatar(p.avatarUrl)}" width="48" height="48" alt="" loading="lazy" decoding="async"><span><b>${escapeHtml(p.login)}</b><small>${commits}</small></span></a></li>`;
      }),
  )
).join("\n");

// Compute ledger: real files only. Examples (EXAMPLE in the name, "example": true inside) are never rendered.
interface LedgerFile {
  example?: boolean;
  run: string;
  islands?: { id: string; name: string; donor: string }[];
  nodes: { github_handle: string; gpu_hours: number }[];
}
const HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const ledgerDir = (await (await github("repos/OpenFrontierLabs/openfrontier/contents/ledger")).json()) as { name: string; path: string; type: string }[];
const ledgerFiles = ledgerDir.filter((f) => f.type === "file" && f.name.endsWith(".json") && f.name !== "schema.json" && !f.name.includes("EXAMPLE"));
const ledgers = (
  await Promise.all(
    ledgerFiles.map(async (f) => ({ file: f, ledger: (await (await github(`repos/OpenFrontierLabs/openfrontier/contents/${f.path}`, "application/vnd.github.raw+json")).json()) as LedgerFile })),
  )
).filter(({ ledger }) => ledger.example !== true);
const donors = new Map<string, { gpuHours: number; runs: Set<string> }>();
const islands = new Map<string, string>();
for (const { file, ledger } of ledgers) {
  for (const node of ledger.nodes) {
    if (!HANDLE.test(node.github_handle) || !Number.isFinite(node.gpu_hours) || node.gpu_hours < 0) throw new Error(`${file.path}: invalid node ${JSON.stringify(node)}`);
    const donor = donors.get(node.github_handle) ?? { gpuHours: 0, runs: new Set<string>() };
    donor.gpuHours += node.gpu_hours;
    donor.runs.add(ledger.run);
    donors.set(node.github_handle, donor);
  }
  for (const island of ledger.islands ?? []) islands.set(`${ledger.run}/${island.id}`, `<li><b>${escapeHtml(island.name)}</b>, donated by ${escapeHtml(island.donor)} (${escapeHtml(ledger.run)})</li>`);
}
const ledgerUrl = "https://github.com/OpenFrontierLabs/openfrontier/tree/main/ledger";
const leaderboard =
  donors.size === 0
    ? `<div class="gcard people-empty"><span class="tag">Planned</span><p>No compute has been donated yet: nothing has been trained, so the <a href="${ledgerUrl}" rel="noopener">compute ledger</a> holds no real entries. When Run 0 produces its first ledger file, every node's GitHub handle and GPU-hours show here, ranked.</p></div>`
    : `<div class="app-table-wrap"><table class="app-table"><thead><tr><th>#</th><th>GitHub handle</th><th>GPU-hours</th><th>Runs</th></tr></thead><tbody>${[...donors]
        .sort(([ha, a], [hb, b]) => b.gpuHours - a.gpuHours || ha.localeCompare(hb))
        .map(([handle, d], i) => `<tr><td>${i + 1}</td><td><a href="https://github.com/${handle}" rel="noopener">${handle}</a></td><td>${d.gpuHours.toLocaleString("en-US", { maximumFractionDigits: 1 })}</td><td>${escapeHtml([...d.runs].sort().join(", "))}</td></tr>`)
        .join("")}</tbody></table></div>${islands.size ? `<h3>Donated clusters (islands)</h3><ul class="people-islands">${[...islands.values()].join("")}</ul>` : ""}<p class="muted">From ${ledgers.map(({ file }) => `<a href="https://github.com/OpenFrontierLabs/openfrontier/blob/main/${escapeHtml(file.path)}" rel="noopener">${escapeHtml(file.name)}</a>`).join(", ")}.</p>`;

// CREDITS.md, word for word; its relative links point into the openfrontier repository.
const creditsHtml = Bun.markdown.html(await (await github("repos/OpenFrontierLabs/openfrontier/contents/CREDITS.md", "application/vnd.github.raw+json")).text());
const credits = creditsHtml
  .replace(/<h1>.+?<\/h1>\n?/, "")
  .replace(/href="(?!https:|#|mailto:)([^"]+)"/g, 'href="https://github.com/OpenFrontierLabs/openfrontier/blob/main/$1" rel="noopener"');

const stats = {
  "%GH_CONTRIBUTORS%": lastPage ?? String(((await contributorsRes.json()) as unknown[]).length),
  "%ACTIVITY%": activity,
  "%CONTRIBUTORS%": contributors,
  "%LEADERBOARD%": leaderboard,
  "%CREDITS%": credits,
};

// The manifesto has one source, content/manifesto.md (identical to MANIFESTO.md in OpenFrontierLabs/openfrontier).
// Principles (a paragraph that opens in bold) and the bold tagline get classes for styling; the words are untouched.
const manifestoHtml = Bun.markdown.html(await readFile(join(root, "content/manifesto.md"), "utf8"));
const manifestoTitle = /<h1>(.+?)<\/h1>/.exec(manifestoHtml)?.[1];
if (!manifestoTitle) throw new Error("content/manifesto.md needs a # title");
const manifesto = manifestoHtml
  .replace(/<h1>.+?<\/h1>\n?/, "")
  .replace(/<p><strong>([^<]+)<\/strong><\/p>/g, '<p class="m-tag"><strong>$1</strong></p>')
  .replaceAll("<p><strong>", '<p class="m-principle"><strong>');

// Shared markup (icon sprite, nav, footer) lives in src/partials and is inlined as <!--#partial name-->.
const partials = new Map<string, string>();
for (const file of await readdir(join(root, "src/partials"))) {
  partials.set(file.replace(/\.html$/, ""), (await readFile(join(root, "src/partials", file), "utf8")).trimEnd());
}
const withPartials = (html: string) =>
  html.replace(/<!--#partial ([\w-]+)-->/g, (_, name: string) => {
    const part = partials.get(name);
    if (part === undefined) throw new Error(`unknown partial ${name}`);
    return part;
  });

const tw = Bun.spawnSync(
  [join(root, "node_modules/.bin/tailwindcss"), "-i", join(root, "src/styles.css"), "--minify"],
  { cwd: root, stdout: "pipe", stderr: "inherit" },
);
if (tw.exitCode !== 0) throw new Error("tailwindcss failed");
const css = tw.stdout.toString()
  .replaceAll("/assets/inter.woff2", `/assets/${fontName}`)
  .replaceAll("/assets/michroma.woff2", `/assets/${displayName}`);
const cssName = `app-${hash(css)}.css`;
await writeFile(join(dist, "assets", cssName), css);

// The dashboard's and the contributors page's own styles ship only with those pages, so the home page doesn't carry them.
async function pageCss(src: string, prefix: string): Promise<string> {
  const tw = Bun.spawnSync([join(root, "node_modules/.bin/tailwindcss"), "-i", join(root, "src", src), "--minify"], { cwd: root, stdout: "pipe", stderr: "inherit" });
  if (tw.exitCode !== 0) throw new Error(`tailwindcss failed on src/${src}`);
  const out = tw.stdout.toString();
  const name = `${prefix}-${hash(out)}.css`;
  await writeFile(join(dist, "assets", name), out);
  return `/assets/${name}`;
}
const dashCssUrl = await pageCss("dashboard.css", "dash");
const peopleCssUrl = await pageCss("contributors.css", "people");

for (const file of (await readdir(join(root, "src"))).filter((f) => f.endsWith(".html"))) {
  const html = withPartials(await readFile(join(root, "src", file), "utf8"))
    .replaceAll("%MANIFESTO_TITLE%", manifestoTitle)
    .replaceAll("%MANIFESTO%", manifesto)
    .replaceAll("%CSS%", `/assets/${cssName}`)
    .replaceAll("%DASH_CSS%", dashCssUrl)
    .replaceAll("%PEOPLE_CSS%", peopleCssUrl)
    .replaceAll("%FONT%", `/assets/${fontName}`)
    .replaceAll("%DISPLAY%", `/assets/${displayName}`);
  await writeFile(join(dist, file), withArt(Object.entries(stats).reduce((h, [k, v]) => h.replaceAll(k, v), html)));
}
// The Worker renders its own pages (/join, /console, /admin) with the same hashed assets.
const workerAssets = { css: `/assets/${cssName}`, font: `/assets/${fontName}`, logoWebp: art.get("arc-160.webp"), logoPng: art.get("arc-160.png") };
await writeFile(join(root, "worker/assets.gen.ts"), `// Generated by scripts/build.ts.\nexport const ASSET = ${JSON.stringify(workerAssets)};\n`);
console.log(`built dist: ${cssName}, ${fontName}`);

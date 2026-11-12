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
// Tests set OFL_GITHUB_FIXTURE to a recorded response file so they never depend on GitHub's rate limit;
// a release never sets it.
interface Pull {
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
}
/** A person with commits in the organisation's repositories; the avatar is copied into dist, never hotlinked. */
interface Person {
  login: string;
  commits: number;
  avatar: { type: string; base64: string };
}
/** One compute ledger file (ledger/*.json in openfrontier, schema.json aside), examples included: they are dropped below. */
interface LedgerFile {
  path: string;
  name: string;
  data: {
    example?: boolean;
    run: string;
    islands?: { id: string; name: string; donor: string }[];
    nodes: { github_handle: string; gpu_hours: number }[];
  };
}
interface GitHubData {
  contributors: number;
  pulls: Record<string, Pull[]>;
  people: Person[];
  ledger: LedgerFile[];
  credits: string;
}
const REPOS = ["openfrontier", "website", ".github"];
async function fromGitHub(): Promise<GitHubData> {
  const token = process.env.GITHUB_TOKEN;
  const github = async (path: string, accept = "application/vnd.github+json") => {
    const res = await fetch(`https://api.github.com/${path}`, {
      headers: { accept, "user-agent": "ofl-website-build", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`GitHub ${path}: HTTP ${res.status}. Set GITHUB_TOKEN (env) and rebuild.`);
    return res;
  };
  const raw = (path: string) => github(`repos/OpenFrontierLabs/openfrontier/contents/${path}`, "application/vnd.github.raw+json");
  const contributorsRes = await github("repos/OpenFrontierLabs/openfrontier/contributors?per_page=1&anon=1");
  const lastPage = /[?&]page=(\d+)>; rel="last"/.exec(contributorsRes.headers.get("link") ?? "")?.[1];
  const contributors = lastPage ? Number(lastPage) : ((await contributorsRes.json()) as unknown[]).length;
  const pulls = Object.fromEntries(
    await Promise.all(REPOS.map(async (repo) => [repo, (await (await github(`repos/OpenFrontierLabs/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=20`)).json()) as Pull[]])),
  );

  const commits = new Map<string, { commits: number; avatarUrl: string }>();
  for (const repo of REPOS) {
    for (let page = 1; ; page++) {
      const res = await github(`repos/OpenFrontierLabs/${repo}/contributors?per_page=100&page=${page}`);
      if (res.status === 204) break; // an empty repository has no contributors
      for (const c of (await res.json()) as { login: string; type: string; avatar_url: string; contributions: number }[]) {
        if (c.type !== "User") continue; // bots are not credited
        const seen = commits.get(c.login) ?? { commits: 0, avatarUrl: c.avatar_url };
        commits.set(c.login, { ...seen, commits: seen.commits + c.contributions });
      }
      if (!/rel="next"/.test(res.headers.get("link") ?? "")) break;
    }
  }
  const people = await Promise.all(
    [...commits].map(async ([login, c]) => {
      const res = await fetch(`${c.avatarUrl}${c.avatarUrl.includes("?") ? "&" : "?"}s=96`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`avatar for ${login}: HTTP ${res.status}`);
      return { login, commits: c.commits, avatar: { type: res.headers.get("content-type") ?? "", base64: Buffer.from(await res.arrayBuffer()).toString("base64") } };
    }),
  );

  const ledgerDir = (await (await github("repos/OpenFrontierLabs/openfrontier/contents/ledger")).json()) as { name: string; path: string; type: string }[];
  const ledger = await Promise.all(
    ledgerDir
      .filter((f) => f.type === "file" && f.name.endsWith(".json") && f.name !== "schema.json")
      .map(async (f) => ({ path: f.path, name: f.name, data: (await (await raw(f.path)).json()) as LedgerFile["data"] })),
  );
  return { contributors, pulls, people, ledger, credits: await (await raw("CREDITS.md")).text() };
}
const fixture = process.env.OFL_GITHUB_FIXTURE;
const gh: GitHubData = fixture ? JSON.parse(await readFile(fixture, "utf8")) : await fromGitHub();

// Recent activity: the latest merged pull requests across the organisation's repositories.
const escapeHtml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const merged = REPOS.flatMap((repo) => (gh.pulls[repo] ?? []).filter((p) => p.merged_at !== null).map((p) => ({ ...p, repo, mergedAt: p.merged_at! })))
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

// Contributors page (/contributors): the people above, the compute ledger and CREDITS.md.
if (gh.people.length === 0) throw new Error("GitHub returned no contributors for the contributors page");
const AVATAR_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const contributorsList = (
  await Promise.all(
    [...gh.people]
      .sort((a, b) => b.commits - a.commits || a.login.localeCompare(b.login))
      .map(async (p) => {
        const ext = AVATAR_TYPES[p.avatar.type];
        if (!ext) throw new Error(`avatar for ${p.login}: unexpected type ${p.avatar.type}`);
        const data = new Uint8Array(Buffer.from(p.avatar.base64, "base64"));
        const file = `avatar-${hash(data)}.${ext}`;
        await writeFile(join(dist, "assets", file), data);
        const commits = `${p.commits.toLocaleString("en-US")} commit${p.commits === 1 ? "" : "s"}`;
        return `<li><a href="https://github.com/${escapeHtml(p.login)}" rel="noopener"><img src="/assets/${file}" width="48" height="48" alt="" loading="lazy" decoding="async"><span><b>${escapeHtml(p.login)}</b><small>${commits}</small></span></a></li>`;
      }),
  )
).join("\n");

// Compute ledger: real files only. Examples (EXAMPLE in the name, "example": true inside) are never rendered.
const HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const ledgers = gh.ledger.filter((f) => !f.name.includes("EXAMPLE") && f.data.example !== true);
const donors = new Map<string, { gpuHours: number; runs: Set<string> }>();
const islands = new Map<string, string>();
for (const { path, data } of ledgers) {
  for (const node of data.nodes) {
    if (!HANDLE.test(node.github_handle) || !Number.isFinite(node.gpu_hours) || node.gpu_hours < 0) throw new Error(`${path}: invalid node ${JSON.stringify(node)}`);
    const donor = donors.get(node.github_handle) ?? { gpuHours: 0, runs: new Set<string>() };
    donor.gpuHours += node.gpu_hours;
    donor.runs.add(data.run);
    donors.set(node.github_handle, donor);
  }
  for (const island of data.islands ?? []) islands.set(`${data.run}/${island.id}`, `<li><b>${escapeHtml(island.name)}</b>, donated by ${escapeHtml(island.donor)} (${escapeHtml(data.run)})</li>`);
}
const ledgerUrl = "https://github.com/OpenFrontierLabs/openfrontier/tree/main/ledger";
const leaderboard =
  donors.size === 0
    ? `<div class="gcard people-empty"><span class="tag">Planned</span><p>No compute has been donated yet: nothing has been trained, so the <a href="${ledgerUrl}" rel="noopener">compute ledger</a> holds no real entries. When Run 0 produces its first ledger file, every node's GitHub handle and GPU-hours show here, ranked.</p></div>`
    : `<div class="app-table-wrap"><table class="app-table"><thead><tr><th>#</th><th>GitHub handle</th><th>GPU-hours</th><th>Runs</th></tr></thead><tbody>${[...donors]
        .sort(([ha, a], [hb, b]) => b.gpuHours - a.gpuHours || ha.localeCompare(hb))
        .map(([handle, d], i) => `<tr><td>${i + 1}</td><td><a href="https://github.com/${handle}" rel="noopener">${handle}</a></td><td>${d.gpuHours.toLocaleString("en-US", { maximumFractionDigits: 1 })}</td><td>${escapeHtml([...d.runs].sort().join(", "))}</td></tr>`)
        .join("")}</tbody></table></div>${islands.size ? `<h3>Donated clusters (islands)</h3><ul class="people-islands">${[...islands.values()].join("")}</ul>` : ""}<p class="muted">From ${ledgers.map((f) => `<a href="https://github.com/OpenFrontierLabs/openfrontier/blob/main/${escapeHtml(f.path)}" rel="noopener">${escapeHtml(f.name)}</a>`).join(", ")}.</p>`;

// CREDITS.md, word for word; its relative links point into the openfrontier repository.
const credits = Bun.markdown
  .html(gh.credits)
  .replace(/<h1>.+?<\/h1>\n?/, "")
  .replace(/href="(?!https:|#|mailto:)([^"]+)"/g, 'href="https://github.com/OpenFrontierLabs/openfrontier/blob/main/$1" rel="noopener"');

const stats = {
  "%GH_CONTRIBUTORS%": String(gh.contributors),
  "%ACTIVITY%": activity,
  "%CONTRIBUTORS%": contributorsList,
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

// The dashboard's, the contributors page's and the signed-in workspace's own styles ship only with their pages.
const pageCss = (src: string) => {
  const out = Bun.spawnSync([join(root, "node_modules/.bin/tailwindcss"), "-i", join(root, "src", src), "--minify"], { cwd: root, stdout: "pipe", stderr: "inherit" });
  if (out.exitCode !== 0) throw new Error(`tailwindcss failed on src/${src}`);
  return out.stdout.toString();
};
const dashCss = pageCss("dashboard.css");
const peopleCss = pageCss("contributors.css");
const wsCss = pageCss("workspace.css");

// Styles are inlined: first paint waits for the HTML alone, not a second request. The CSP admits each
// inline stylesheet by its SHA-256, so `style-src` never needs 'unsafe-inline'.
const cspHash = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;
if ([css, dashCss, peopleCss, wsCss].some((c) => c.includes("</style"))) throw new Error("stylesheet text would close its <style> element");
const headers = await readFile(join(dist, "_headers"), "utf8");
if (!headers.includes("style-src 'self';")) throw new Error("public/_headers lost its style-src 'self' directive");
await writeFile(join(dist, "_headers"), headers.replaceAll("style-src 'self';", `style-src 'self' ${cspHash(css)} ${cspHash(dashCss)} ${cspHash(peopleCss)};`));

for (const file of (await readdir(join(root, "src"))).filter((f) => f.endsWith(".html"))) {
  const html = withPartials(await readFile(join(root, "src", file), "utf8"))
    .replaceAll("%MANIFESTO_TITLE%", manifestoTitle)
    .replaceAll("%MANIFESTO%", manifesto)
    .replaceAll('<link rel="stylesheet" href="%CSS%">', () => `<style>${css}</style>`)
    .replaceAll('<link rel="stylesheet" href="%DASH_CSS%">', () => `<style>${dashCss}</style>`)
    .replaceAll('<link rel="stylesheet" href="%PEOPLE_CSS%">', () => `<style>${peopleCss}</style>`);
  if (/%(?:DASH_|PEOPLE_)?CSS%/.test(html)) throw new Error(`${file}: stylesheet placeholder outside a <link rel="stylesheet">`);
  await writeFile(join(dist, file), withArt(Object.entries(stats).reduce((h, [k, v]) => h.replaceAll(k, () => v), html)));
}
// The Worker renders its own pages (/join, /console, /admin) with the same inline stylesheet, plus the
// workspace's, each admitted by hash.
const workerAssets = {
  css,
  cssHash: cspHash(css),
  wsCss,
  wsCssHash: cspHash(wsCss),
  wsSprite: partials.get("sprite-ws"),
  logoAvif: art.get("arc-160.avif"),
  logoWebp: art.get("arc-160.webp"),
  logoPng: art.get("arc-160.png"),
};
if (Object.values(workerAssets).some((v) => !v)) throw new Error("worker asset missing (sprite-ws partial or arc-160 art)");
await writeFile(join(root, "worker/assets.gen.ts"), `// Generated by scripts/build.ts.\nexport const ASSET = ${JSON.stringify(workerAssets)};\n`);
console.log(`built dist: styles inline (${css.length} + ${dashCss.length} + ${peopleCss.length} + ${wsCss.length} bytes), ${fontName}`);

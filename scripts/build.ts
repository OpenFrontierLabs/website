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
async function github(path: string): Promise<Response> {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      accept: "application/vnd.github+json",
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
    ["openfrontier", "website", ".github"].map(async (repo) => {
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

const stats = {
  "%GH_CONTRIBUTORS%": lastPage ?? String(((await contributorsRes.json()) as unknown[]).length),
  "%ACTIVITY%": activity,
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

// The dashboard's own styles ship only with /dashboard, so the home page doesn't carry them.
const dashTw = Bun.spawnSync([join(root, "node_modules/.bin/tailwindcss"), "-i", join(root, "src/dashboard.css"), "--minify"], { cwd: root, stdout: "pipe", stderr: "inherit" });
if (dashTw.exitCode !== 0) throw new Error("tailwindcss failed on src/dashboard.css");
const dashCss = dashTw.stdout.toString();
const dashCssName = `dash-${hash(dashCss)}.css`;
await writeFile(join(dist, "assets", dashCssName), dashCss);

for (const file of (await readdir(join(root, "src"))).filter((f) => f.endsWith(".html"))) {
  const html = withPartials(await readFile(join(root, "src", file), "utf8"))
    .replaceAll("%MANIFESTO_TITLE%", manifestoTitle)
    .replaceAll("%MANIFESTO%", manifesto)
    .replaceAll("%CSS%", `/assets/${cssName}`)
    .replaceAll("%DASH_CSS%", `/assets/${dashCssName}`)
    .replaceAll("%FONT%", `/assets/${fontName}`)
    .replaceAll("%DISPLAY%", `/assets/${displayName}`);
  await writeFile(join(dist, file), withArt(Object.entries(stats).reduce((h, [k, v]) => h.replaceAll(k, v), html)));
}
// The Worker renders its own pages (/join, /console, /admin) with the same hashed assets.
const workerAssets = { css: `/assets/${cssName}`, font: `/assets/${fontName}`, logoWebp: art.get("arc-160.webp"), logoPng: art.get("arc-160.png") };
await writeFile(join(root, "worker/assets.gen.ts"), `// Generated by scripts/build.ts.\nexport const ASSET = ${JSON.stringify(workerAssets)};\n`);
console.log(`built dist: ${cssName}, ${fontName}`);

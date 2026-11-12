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

// Real numbers only: GitHub stars and contributors, fetched at build time; 0 when unreachable.
async function github(path: string): Promise<Response | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/OpenFrontierLabs/openfrontier${path}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "ofl-website-build" },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}
const repo = (await (await github(""))?.json()) as { stargazers_count?: number } | undefined;
const contributorsRes = await github("/contributors?per_page=1&anon=1");
const lastPage = /[?&]page=(\d+)>; rel="last"/.exec(contributorsRes?.headers.get("link") ?? "")?.[1];
const contributorList = contributorsRes ? ((await contributorsRes.json()) as unknown[]) : [];
const stats = {
  "%GH_STARS%": String(repo?.stargazers_count ?? 0),
  "%GH_CONTRIBUTORS%": lastPage ?? String(contributorList.length),
};

// The manifesto is rendered from content/manifesto.md verbatim: paragraphs and **bold** only.
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const [titleLine, ...paragraphs] = (await readFile(join(root, "content/manifesto.md"), "utf8")).trim().split(/\n\s*\n/);
if (!titleLine?.startsWith("# ")) throw new Error("content/manifesto.md must start with a # title");
const manifesto = {
  "%MANIFESTO_TITLE%": escape(titleLine.slice(2)),
  "%MANIFESTO%": paragraphs
    .map((p) => {
      const html = escape(p.replace(/\s*\n\s*/g, " ")).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      return /^\*\*[^*]+\*\*$/.test(p) ? `<p class="m-coda">${html}</p>` : `<p>${html}</p>`;
    })
    .join("\n"),
};

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

for (const file of (await readdir(join(root, "src"))).filter((f) => f.endsWith(".html"))) {
  const html = (await readFile(join(root, "src", file), "utf8"))
    .replaceAll("%CSS%", `/assets/${cssName}`)
    .replaceAll("%FONT%", `/assets/${fontName}`)
    .replaceAll("%DISPLAY%", `/assets/${displayName}`);
  const filled = Object.entries({ ...stats, ...manifesto }).reduce((h, [k, v]) => h.replaceAll(k, v), html);
  await writeFile(join(dist, file), withArt(filled));
}
console.log(`built dist: ${cssName}, ${fontName}`);

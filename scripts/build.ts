import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const fontSrc = join(root, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2");

const hash = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex").slice(0, 10);

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "assets"), { recursive: true });
await cp(join(root, "public"), dist, { recursive: true });

const font = new Uint8Array(await readFile(fontSrc));
const fontName = `inter-${hash(font)}.woff2`;
await writeFile(join(dist, "assets", fontName), font);

const tw = Bun.spawnSync(
  [join(root, "node_modules/.bin/tailwindcss"), "-i", join(root, "src/styles.css"), "--minify"],
  { cwd: root, stdout: "pipe", stderr: "inherit" },
);
if (tw.exitCode !== 0) throw new Error("tailwindcss failed");
const css = tw.stdout.toString().replaceAll("/assets/inter.woff2", `/assets/${fontName}`);
const cssName = `app-${hash(css)}.css`;
await writeFile(join(dist, "assets", cssName), css);

const logo = (await readFile(join(root, "public/logo.svg"), "utf8"))
  .replace("<svg ", '<svg class="logo" role="img" aria-labelledby="logo-title" ')
  .replace("<title>", '<title id="logo-title">')
  .trim();

for (const file of (await readdir(join(root, "src"))).filter((f) => f.endsWith(".html"))) {
  const html = (await readFile(join(root, "src", file), "utf8"))
    .replaceAll("%CSS%", `/assets/${cssName}`)
    .replaceAll("%FONT%", `/assets/${fontName}`)
    .replaceAll("<!--LOGO-->", logo);
  await writeFile(join(dist, file), html);
}
console.log(`built dist: ${cssName}, ${fontName}`);

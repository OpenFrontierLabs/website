// Regenerates PNG/ICO assets in public/ from the SVG sources. Needs rsvg-convert on PATH
// (override with RSVG_CONVERT). Run: bun run assets
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const pub = join(root, "public");
const rsvg = process.env.RSVG_CONVERT ?? "rsvg-convert";

async function render(svgPath: string, out: string, width: number, height: number): Promise<Uint8Array> {
  const proc = Bun.spawnSync([rsvg, "-w", String(width), "-h", String(height), "-o", out, svgPath], {
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) throw new Error(`rsvg-convert failed for ${svgPath}`);
  return new Uint8Array(await readFile(out));
}

const favicon = join(pub, "favicon.svg");
await render(favicon, join(pub, "apple-touch-icon.png"), 180, 180);
await render(favicon, join(pub, "icon-192.png"), 192, 192);
await render(favicon, join(pub, "icon-512.png"), 512, 512);

// PNG-in-ICO: 16, 32, 48.
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => render(favicon, join(pub, `.ico-${s}.png`), s, s)));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const png = pngs[i]!;
  const at = 6 + i * 16;
  header.writeUInt8(size, at);
  header.writeUInt8(size, at + 1);
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(png.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
await writeFile(join(pub, "favicon.ico"), Buffer.concat([header, ...pngs]));
await Promise.all(sizes.map((s) => Bun.file(join(pub, `.ico-${s}.png`)).delete()));

// OG image 1200x630: logo + wordmark + tagline on graphite.
const logo = (await readFile(join(pub, "logo.svg"), "utf8")).replace(
  "<svg ",
  '<svg x="400" y="28" width="400" height="400" ',
);
const font = "Inter, 'Noto Sans', 'DejaVu Sans', sans-serif";
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#0B0E0D"/>
${logo}
<text x="600" y="508" text-anchor="middle" font-family="${font}" font-size="44" font-weight="600" letter-spacing="14" fill="#F5F7F6">OPEN FRONTIER LABS</text>
<text x="600" y="565" text-anchor="middle" font-family="${font}" font-size="27" fill="#A1A8AD">Open infrastructure for collective frontier intelligence</text>
</svg>`;
const ogSvg = join(root, "node_modules/.og.svg");
await writeFile(ogSvg, og);
await render(ogSvg, join(pub, "og.png"), 1200, 630);
await Bun.file(ogSvg).delete();
console.log("assets regenerated");

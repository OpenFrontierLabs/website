// Regenerates art/ (AVIF, WebP, PNG) and public/ icons + OG image from the official art in
// brand/ (override with OFL_BRAND_DIR). Run: bun run assets
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type Sharp } from "sharp";

const root = join(import.meta.dir, "..");
const art = join(root, "art");
const pub = join(root, "public");
const brand = process.env.OFL_BRAND_DIR ?? join(root, "brand");
const src = (name: string) => join(brand, name);

await rm(art, { recursive: true, force: true });
await mkdir(art, { recursive: true });

// Glow art sits on pure black: luminance becomes alpha so the mark works on any dark surface.
async function transparent(file: string, size: number): Promise<Buffer> {
  const { data, info } = await sharp(src(file)).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const a = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
    if (a === 0) continue;
    data[i] = Math.min(255, Math.round((data[i]! * 255) / a));
    data[i + 1] = Math.min(255, Math.round((data[i + 1]! * 255) / a));
    data[i + 2] = Math.min(255, Math.round((data[i + 2]! * 255) / a));
    data[i + 3] = a;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function emit(name: string, image: Sharp): Promise<void> {
  const buf = await image.png().toBuffer();
  await Promise.all([
    sharp(buf).avif({ quality: 55, effort: 6 }).toFile(join(art, `${name}.avif`)),
    sharp(buf).webp({ quality: 72, effort: 6, alphaQuality: 90 }).toFile(join(art, `${name}.webp`)),
    sharp(buf).png({ palette: true, quality: 80, effort: 10 }).toFile(join(art, `${name}.png`)),
  ]);
}

// Marks (transparent).
const hex = await transparent("hex-logo-1024.png", 1254);
const trimmed = await sharp(hex).trim({ threshold: 4 }).toBuffer({ resolveWithObject: true });
const square = (buf: Buffer, size: number, pad = 0) =>
  sharp(buf).resize(size - pad * 2, size - pad * 2, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } });
const arcLogo = await transparent("arc-logo-1024.png", 1024);
await emit("arc-160", square(arcLogo, 160));
// Hero arc stays opaque (blended with mix-blend-mode: screen on the page): its black is not pure black.
const arcBox = await sharp(src("arc-logo-1024.png")).trim({ background: "#000", threshold: 24 }).toBuffer({ resolveWithObject: true });
const pad = 24;
await emit("arc-hero", sharp(arcBox.data).extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#000" }).resize({ width: 760 }));

// Horizon backgrounds: bottom of the poster (mobile) and of the hex banner (desktop).
const poster = sharp(src("poster-hex-576x1024.png"));
const pm = await poster.metadata();
const top = Math.round(pm.height! * 0.66);
await emit("horizon-m", sharp(src("poster-hex-576x1024.png")).extract({ left: 0, top, width: pm.width!, height: pm.height! - top }).resize({ width: 828 }));
const bm = await sharp(src("banner-hex-3x1.png")).metadata();
const btop = Math.round(bm.height! * 0.55);
await emit("horizon-d", sharp(src("banner-hex-3x1.png")).extract({ left: 0, top: btop, width: bm.width!, height: bm.height! - btop }).resize({ width: 2048 }));

// OG 1200x630: full 3:1 banner on its own black field.
const banner = await sharp(src("banner-arc-3x1.png")).resize({ width: 1200 }).png().toBuffer();
const og = await sharp({ create: { width: 1200, height: 630, channels: 3, background: "#000" } })
  .composite([{ input: banner, top: 115, left: 0 }])
  .png({ palette: true, quality: 85, effort: 10 })
  .toBuffer();
await writeFile(join(pub, "og.png"), og);

// Icons from the transparent mark.
const icon = (size: number, pad: number) => square(trimmed.data, size, pad).png({ palette: true, quality: 90, effort: 10 }).toBuffer();
await writeFile(join(pub, "icon-192.png"), await icon(192, 16));
await writeFile(join(pub, "icon-512.png"), await icon(512, 40));
await writeFile(join(pub, "apple-touch-icon.png"), await sharp(await icon(180, 20)).flatten({ background: "#000" }).png().toBuffer());
await writeFile(join(pub, "favicon-32.png"), await icon(32, 1));

// PNG-in-ICO: 16, 32, 48.
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => icon(s, 1)));
const header = Buffer.alloc(6 + 16 * sizes.length);
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
console.log("assets regenerated");

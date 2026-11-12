import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = join(import.meta.dir, "../dist");
const build = Bun.spawnSync(["bun", join(import.meta.dir, "../scripts/build.ts")], { stderr: "inherit" });
if (build.exitCode !== 0) throw new Error("build failed");
const read = (f: string) => readFileSync(join(dist, f), "utf8");
const index = read("index.html");
const all = `${index}\n${read("404.html")}`;

describe("dist", () => {
  test("required files exist; no redirects file", () => {
    for (const f of ["index.html", "404.html", "_headers", "robots.txt", "sitemap.xml", "favicon-32.png", "favicon.ico", "og.png", "site.webmanifest"]) {
      expect(existsSync(join(dist, f))).toBe(true);
    }
    expect(existsSync(join(dist, "_redirects"))).toBe(false);
  });

  test("required sections exist", () => {
    for (const id of ["top", "main", "mission", "how", "platform", "community", "research", "network", "join"]) {
      expect(index).toContain(`id="${id}"`);
    }
  });

  test("internal links and anchors resolve", () => {
    const ids = new Set([...index.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of index.matchAll(/href="([^"]+)"/g)) {
      const href = m[1]!;
      if (href.startsWith("#")) expect(ids.has(href.slice(1))).toBe(true);
      else if (href.startsWith("/")) expect(existsSync(join(dist, href.split(/[?#]/)[0]!))).toBe(true);
    }
    for (const m of all.matchAll(/(?:src|href)="(\/[^"]*)"/g)) {
      const p = m[1]!.split(/[?#]/)[0]!;
      expect(p === "/" || existsSync(join(dist, p))).toBe(true);
    }
  });

  test("no link targets a .html path (html_handling would 307 it)", () => {
    expect(all).not.toMatch(/(?:href|src)="[^"]*\.html/);
  });

  test("contact strings present", () => {
    expect(index).toContain("openfrontierlabs@gmail.com");
    expect(index).toContain("https://github.com/OpenFrontierLabs/openfrontier");
    expect(index).toContain("https://x.com/openfrontlabs");
    expect(index).toContain("subject=Donate%20compute%20to%20Open%20Frontier%20Labs");
  });

  test("forbidden strings absent", () => {
    expect(all).not.toContain("hello@");
    expect(all).not.toContain("openfronterlabs");
    expect(all).not.toContain("TODO");
    expect(all).not.toMatch(/http:\/\/(?!www\.w3\.org\/2000\/svg)/);
    expect(all).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(all).not.toMatch(/<script(?![^>]*application\/ld\+json)/);
    expect(all).not.toMatch(/\sstyle="/);
  });

  test("headers carry strict CSP", () => {
    const h = read("_headers");
    expect(h).toContain("default-src 'none'");
    expect(h).toContain("script-src 'none'");
    expect(h).toContain("frame-ancestors 'none'");
  });

  test("html + css + fonts within raw size budget; images are separate", () => {
    expect(statSync(join(dist, "index.html")).size).toBeLessThan(60_000);
    const code = readdirSync(join(dist, "assets"))
      .filter((f) => /\.(css|woff2)$/.test(f))
      .reduce((n, f) => n + statSync(join(dist, "assets", f)).size, 0);
    expect(code + statSync(join(dist, "index.html")).size).toBeLessThan(150_000);
  });

  test("hero art is AVIF-first with a PNG fallback and preloaded", () => {
    expect(index).toMatch(/<source srcset="\/assets\/arc-hero-\w+\.avif" type="image\/avif">/);
    expect(index).toMatch(/<img src="\/assets\/arc-hero-\w+\.png"/);
    expect(index).toMatch(/rel="preload" as="image" href="\/assets\/arc-hero-\w+\.avif"/);
  });

  test("no invented numbers from the mockup", () => {
    for (const fake of ["18,400", "420K", "1,200+", "380+"]) expect(index).not.toContain(fake);
    expect(index).toContain("The network starts with you. Run 0 opens soon.");
    expect(index).not.toContain("%GH_");
  });

  test("og.png is 1200x630", () => {
    const png = readFileSync(join(dist, "og.png"));
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = join(import.meta.dir, "../dist");
const build = Bun.spawnSync(["bun", join(import.meta.dir, "../scripts/build.ts")], { stderr: "inherit" });
if (build.exitCode !== 0) throw new Error("build failed");
const read = (f: string) => readFileSync(join(dist, f), "utf8");
const index = read("index.html");
const manifestoPage = read("manifesto.html");
const pages = { "index.html": index, "manifesto.html": manifestoPage };
const all = `${index}\n${manifestoPage}\n${read("404.html")}`;

describe("dist", () => {
  test("required files exist; no redirects file", () => {
    for (const f of ["index.html", "manifesto.html", "404.html", "_headers", "robots.txt", "sitemap.xml", "favicon-32.png", "favicon.ico", "og.png", "site.webmanifest"]) {
      expect(existsSync(join(dist, f))).toBe(true);
    }
    expect(existsSync(join(dist, "_redirects"))).toBe(false);
  });

  test("required sections exist", () => {
    for (const id of ["top", "main", "mission", "manifesto", "how", "try", "platform", "community", "research", "network", "join"]) {
      expect(index).toContain(`id="${id}"`);
    }
  });

  test("internal links and anchors resolve on the page they point to", () => {
    const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const [name, html] of Object.entries(pages)) {
      for (const m of html.matchAll(/href="([^"]+)"/g)) {
        const href = m[1]!;
        if (href.startsWith("#")) expect(ids(html).has(href.slice(1)), `${name}: ${href}`).toBe(true);
        else if (href.startsWith("/")) {
          const [path, frag] = href.split("#") as [string, string | undefined];
          // Workers html_handling "auto-trailing-slash": / is index.html, /manifesto is manifesto.html.
          const file = path === "/" ? "index.html" : /\.\w+$/.test(path) ? path.slice(1) : `${path.slice(1)}.html`;
          expect(existsSync(join(dist, file)), `${name}: ${href}`).toBe(true);
          if (frag) expect(ids(read(file)).has(frag), `${name}: ${href}`).toBe(true);
        }
      }
    }
    for (const m of all.matchAll(/src(?:set)?="(\/[^"]*)"/g)) {
      expect(existsSync(join(dist, m[1]!.split(/[?#]/)[0]!))).toBe(true);
    }
  });

  test("manifesto words are published unedited on both pages", () => {
    const words = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
    const md = readFileSync(join(import.meta.dir, "../content/manifesto.md"), "utf8");
    const body = words(md.replace(/^# .*$/m, "").replaceAll("**", ""));
    for (const html of [index, manifestoPage]) {
      expect(html).toContain("The Open Frontier Manifesto");
      const start = html.indexOf('<div class="manifesto-body">');
      expect(words(html.slice(start, html.indexOf("</div>", start)))).toBe(body);
    }
    expect(read("sitemap.xml")).toContain("https://openfrontier-labs.com/manifesto");
    expect(index.match(/href="\/manifesto"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(manifestoPage).toContain('<link rel="canonical" href="https://openfrontier-labs.com/manifesto">');
  });

  test("mobile menu is CSS-only and every menu link leaves #menu", () => {
    for (const html of [index, manifestoPage]) {
      const menu = /<nav id="menu"[^]*?<\/nav>/.exec(html)?.[0] ?? "";
      expect(menu).not.toBe("");
      expect(html).not.toContain("<details");
      for (const m of menu.matchAll(/href="([^"]+)"/g)) expect(m[1]).not.toBe("#menu");
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

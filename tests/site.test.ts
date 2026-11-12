import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = join(import.meta.dir, "../dist");
// Recorded GitHub responses: the suite never depends on GitHub's rate limit (a release reads GitHub live).
const build = Bun.spawnSync(["bun", join(import.meta.dir, "../scripts/build.ts")], {
  stderr: "inherit",
  env: { ...process.env, OFL_GITHUB_FIXTURE: join(import.meta.dir, "fixtures/github.json") },
});
if (build.exitCode !== 0) throw new Error("build failed");
const read = (f: string) => readFileSync(join(dist, f), "utf8");
const index = read("index.html");
const manifestoPage = read("manifesto.html");
const dashboard = read("dashboard.html");
const pages = { "index.html": index, "manifesto.html": manifestoPage, "dashboard.html": dashboard };
const all = `${index}\n${manifestoPage}\n${dashboard}\n${read("404.html")}`;

describe("dist", () => {
  test("required files exist; no redirects file", () => {
    for (const f of ["index.html", "manifesto.html", "404.html", "_headers", "robots.txt", "sitemap.xml", "favicon-32.png", "favicon.ico", "og.png", "site.webmanifest"]) {
      expect(existsSync(join(dist, f))).toBe(true);
    }
    expect(existsSync(join(dist, "_redirects"))).toBe(false);
  });

  test("required sections exist", () => {
    for (const id of ["top", "main", "mission", "manifesto", "how", "stack", "try", "platform", "community", "research", "network", "join"]) {
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
          if (path === "/join") continue; // served by the Worker (tests/app.test.ts)
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

  test("home page transfer budget: gzipped html (styles inline) and its fonts; images are separate", () => {
    const gz = (bytes: Buffer) => Bun.gzipSync(new Uint8Array(bytes)).length;
    const html = gz(readFileSync(join(dist, "index.html")));
    expect(html).toBeLessThan(25_000);
    const fonts = [...new Set([...index.matchAll(/\/assets\/([^)"]+\.woff2)/g)].map((m) => m[1]!))];
    expect(fonts.length).toBe(2);
    const fontBytes = fonts.reduce((n, f) => n + statSync(join(dist, "assets", f)).size, 0);
    expect(html + fontBytes).toBeLessThan(100_000);
  });

  test("every inline stylesheet is admitted by its hash, never by 'unsafe-inline'", () => {
    const h = read("_headers");
    expect(h).not.toContain("unsafe-inline");
    const csps = h.match(/Content-Security-Policy: [^\n]+/g)!;
    expect(csps.length).toBe(2);
    for (const [name, html] of Object.entries({ ...pages, "404.html": read("404.html") })) {
      expect(html, name).not.toContain('rel="stylesheet"');
      const styles = [...html.matchAll(/<style>([^]*?)<\/style>/g)].map((m) => m[1]!);
      expect(styles.length, name).toBeGreaterThan(0);
      for (const css of styles) {
        const hash = `'sha256-${new Bun.CryptoHasher("sha256").update(css).digest("base64")}'`;
        for (const csp of csps) expect(csp, name).toContain(hash);
      }
    }
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

  test("dashboard: real numbers and a real activity feed, never the mockup's", () => {
    for (const fake of ["18,642", "424,771", "1,203", "389", "12,480", "72.4%", "74.2%", "OFL-LLM-32B", "RUNNING"]) expect(dashboard).not.toContain(fake);
    expect(dashboard).not.toMatch(/%[A-Z_]+%/);
    const items = [...dashboard.matchAll(/<li><svg class="act-ico"[^]*?href="(https:\/\/github\.com\/OpenFrontierLabs\/[^"]+\/pull\/\d+)"[^]*?<time datetime="([^"]+)"/g)];
    expect(items.length).toBeGreaterThan(0);
    const times = items.map((m) => m[2]!);
    expect([...times].sort().reverse()).toEqual(times);
  });

  test("only the dashboard may submit a form, and only to GitHub", () => {
    const h = read("_headers");
    expect(h.match(/form-action [^;]+/g)).toEqual(["form-action 'none'", "form-action https://github.com"]);
    expect(h).toMatch(/\/dashboard\n {2}! Content-Security-Policy\n {2}Content-Security-Policy: [^\n]*form-action https:\/\/github\.com/);
    expect(dashboard).toContain('<form class="dash-search" action="https://github.com/OpenFrontierLabs/openfrontier/search" method="get"');
  });

  test("og.png is 1200x630", () => {
    const png = readFileSync(join(dist, "og.png"));
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});

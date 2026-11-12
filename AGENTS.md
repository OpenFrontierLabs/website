# Open Frontier Labs website

Frontend: static HTML + Tailwind v4 (no framework: single static page; hydrogen/React not warranted)

- Source: pages `src/index.html`, `src/manifesto.html` (served at `/manifesto`), `src/404.html`; shared markup (icon sprite, nav, footer) in `src/partials/`, inlined by `<!--#partial name-->`; `src/styles.css`; static files in `public/` (including `_headers`); `scripts/build.ts` produces `dist/` with content-hashed CSS, fonts (Inter body, Michroma display caps) and art.
- Manifesto: `content/manifesto.md` is the one source, word for word the same as `MANIFESTO.md` in OpenFrontierLabs/openfrontier; the build renders it into both pages. Never edit its words here; change it upstream first, then copy.
- Stats: the build reads the GitHub contributor count and fails if GitHub refuses (no made-up 0); set `GITHUB_TOKEN` in the environment (never argv) when the anonymous rate limit bites.
- Motion: CSS only (no scripts under the CSP), all inside `prefers-reduced-motion: no-preference`; scroll-driven effects sit behind `@supports (animation-timeline: view())`. Keyframe names must not clash with Tailwind's (`spin`, `ping`, `pulse`, `bounce`).
- Art: official brand PNGs live in `brand/` (source of truth; no redrawn logos). `bun run assets` (sharp) regenerates `art/` (AVIF/WebP/PNG, content-hashed by the build, referenced as `%ART:file%`) and the icons/OG in `public/`.
- Deploy target: Cloudflare Workers Static Assets, assets-only (`wrangler.toml`). Deploy: `make release` (build, then `wrangler deploy`), run on a fleet host through `heavy-build-route`.
- Check: `make check` (typecheck, oxlint, build, `bun test tests/site.test.ts`). Always name the test file.

## Rules

- Bun only. No redirects of any kind (no `_redirects`, no redirect rules). Both domains are served directly.
- No crons, no Worker script, no D1/KV/R2/queues, no form backend, no third-party scripts. $0 marginal cost. No remote state.
- Strict CSP: no inline scripts or `style` attributes; use classes.
- Content rule: no claims about results, traction, users, team size, funding, partnerships, endorsements or benchmarks. Anything not built is labelled "planned". No emoji. Email spelling is `openfrontierlabs@gmail.com` (with an i).

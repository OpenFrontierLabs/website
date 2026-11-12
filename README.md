# Open Frontier Labs website

Single-page site for [Open Frontier Labs](https://openfrontier-labs.com): open infrastructure for collective frontier intelligence. Static HTML + Tailwind CSS v4, deployed as Cloudflare Workers Static Assets (no Worker script).

```
make setup    # bun install
make dev      # build and serve dist on a kernel-assigned port
make check    # typecheck, lint, build, tests
make release  # build, then wrangler deploy
```

Brand tokens (`src/styles.css`): Frontier Green `#66E36E`, Compute Green `#1B7F46`, Graphite `#0B0E0D`, Silver Gray `#6B7177` (decor only; body text uses the lighter `#A1A8AD` for AA contrast), Soft White `#F5F7F6`. Font: Inter variable, self-hosted.

Licence: Apache-2.0.

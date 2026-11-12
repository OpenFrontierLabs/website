# Open Frontier Labs website

Single-page site for [Open Frontier Labs](https://openfrontier-labs.com): open infrastructure for collective frontier intelligence. Static HTML + Tailwind CSS v4 on Cloudflare Workers Static Assets, plus a small Worker (`worker/`) and a D1 database (`ofl-waitlist`, schema in `migrations/`) for GitHub sign-up, the waitlist questionnaire, the Member Console (`/console`) and the Operator Console (`/admin`).

```
make setup    # bun install
make migrate  # apply D1 migrations to the local database
make dev      # build, then wrangler dev with local D1 (secrets in .dev.vars)
make check    # build, typecheck, lint, tests
make release  # build, apply D1 migrations remotely, wrangler deploy
```

Secrets (`wrangler secret put`): `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`. Local `.dev.vars` needs those two plus `APP_ORIGIN=http://localhost:<port>`. Operators are active admins of the OpenFrontierLabs org, or the logins in `ADMIN_GITHUB_LOGINS`.

Brand tokens (`src/styles.css`): Frontier Green `#66E36E`, Compute Green `#1B7F46`, Graphite `#0B0E0D`, Silver Gray `#6B7177` (decor only; body text uses the lighter `#A1A8AD` for AA contrast), Soft White `#F5F7F6`. Font: Inter variable, self-hosted.

Licence: Apache-2.0.

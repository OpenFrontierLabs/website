# Open Frontier Labs website

[![Quality gate](https://sonarcloud.io/api/project_badges/measure?project=OpenFrontierLabs_website&metric=alert_status)](https://sonarcloud.io/project/overview?id=OpenFrontierLabs_website)

Single-page site for [Open Frontier Labs](https://openfrontier-labs.com): open infrastructure for collective frontier intelligence. Static HTML + Tailwind CSS v4 on Cloudflare Workers Static Assets, plus a small Worker (`worker/`) and a D1 database (`ofl-waitlist`, schema in `migrations/`) for GitHub sign-up, the waitlist questionnaire, the contributor workspace (`/console`) and the Operator Console (`/admin`). `/contributors` is built from GitHub at build time: commit authors, the compute ledger and `CREDITS.md`.

```
make setup    # bun install
make migrate  # apply D1 migrations to the local database
make dev      # build, then wrangler dev with local D1 (secrets in .dev.vars)
make check    # build, typecheck, lint, tests
make release  # build, then D1 migrations + wrangler deploy with a broker-minted token
```

Secrets (`wrangler secret put`): `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, `SWARM_INGEST_TOKEN`, `SENTRY_DSN`, `SENTRY_TEST_KEY`; `GITHUB_CLIENT_ID` goes in `[vars]`. Until both GitHub values exist, `/auth/github` answers 503. Local `.dev.vars` needs `SESSION_SECRET` and `APP_ORIGIN=http://localhost:<port>`. Operators are active admins of the OpenFrontierLabs org, or the logins in `ADMIN_GITHUB_LOGINS`.

## Sentry error monitoring

Server-side Worker instrumentation only (`@sentry/cloudflare` `withSentry` in `worker/index.ts`, configured in `worker/sentry.ts`). No client-side scripts are added; the `script-src 'none'` CSP is unchanged.

- **Reported**: uncaught Worker exceptions and sampled request traces (`tracesSampleRate: 0.1`, `environment: "production"`, `release` = git short SHA injected via `--var SENTRY_RELEASE:<sha>` in `make release`). When `~/.config/ofl/sentry.env` is present during `make release`, `scripts/release.ts` injects debug IDs and uploads sourcemaps via `@sentry/cli`; if absent, sourcemap upload is skipped with a warning.
- **PII policy**: `dataCollection` disables user info/IP (`userInfo: false`), cookies (`cookies: false`), request/response bodies (`httpBodies: []`), URL query parameters (`urlQueryParams: false`), D1 query parameters (`databaseQueryData: false`), and sensitive headers (`authorization`, `cookie`, `set-cookie`, `cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`, `x-sentry-test`, etc.). `httpServerIntegration` sets `maxRequestBodySize: "none"`, and `beforeSend`/`beforeSendSpan` scrub any residual user objects, request bodies, cookies, sensitive headers, and email addresses.
- **How to disable**: remove the `SENTRY_DSN` secret (`wrangler secret delete SENTRY_DSN`). When `SENTRY_DSN` is unset or empty, Sentry reporting (`enabled`) and tracing (`tracesSampleRate`) are off.
- **Verification probe**: `/__sentry-test` returns the normal 404 unless the `x-sentry-test` header matches the `SENTRY_TEST_KEY` Worker secret, in which case it throws `Error("ofl sentry test")`.

Brand tokens (`src/styles.css`): Frontier Green `#66E36E`, Compute Green `#1B7F46`, Graphite `#0B0E0D`, Silver Gray `#6B7177` (decor only; body text uses the lighter `#A1A8AD` for AA contrast), Soft White `#F5F7F6`. Font: Inter variable, self-hosted.

Commits need a DCO sign-off (`git commit -s`).

Licence: Apache-2.0.

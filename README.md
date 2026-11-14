# Open Frontier Labs website

[![Quality gate](https://sonarcloud.io/api/project_badges/measure?project=OpenFrontierLabs_website&metric=alert_status)](https://sonarcloud.io/project/overview?id=OpenFrontierLabs_website)

Single-page site for [Open Frontier Labs](https://openfrontier-labs.com): open infrastructure for collective frontier intelligence. Static HTML + Tailwind CSS v4 on Cloudflare Workers Static Assets, plus a small Worker (`worker/`) and a D1 database (`ofl-waitlist`, schema in `migrations/`) for GitHub sign-up, the waitlist questionnaire, the contributor workspace (`/console`) and the Operator Console (`/admin`). `/contributors` is built from GitHub at build time: commit authors, the compute ledger and `CREDITS.md`.

```
make setup    # bun install
make migrate  # apply D1 migrations to the local database
make dev      # build, then wrangler dev with local D1 (secrets in .dev.vars)
make check    # build, typecheck, lint, tests
make release  # build, apply remote D1 migrations, deploy Worker (broker token), and upload Sentry sourcemaps when ~/.config/ofl/sentry.env exists
```

Secrets (`wrangler secret put`): `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, `SWARM_INGEST_TOKEN`, `SENTRY_DSN`, `SENTRY_TEST_KEY`; `GITHUB_CLIENT_ID` goes in `[vars]`. Until both GitHub values exist, `/auth/github` answers 503. Local `.dev.vars` needs `SESSION_SECRET` and `APP_ORIGIN=http://localhost:<port>`. Operators are active admins of the OpenFrontierLabs org, or the logins in `ADMIN_GITHUB_LOGINS`.

## Sentry error monitoring

Server-side Worker instrumentation only (`@sentry/cloudflare` `withSentry` in `worker/index.ts`, configured in `worker/sentry.ts`, with `compatibility_flags = ["nodejs_compat"]` and `upload_source_maps = true` in `wrangler.toml`). No browser/client-side script is loaded, and the `script-src 'none'` CSP in `public/_headers` and `worker/html.ts` is unchanged. The shared footer (`src/partials/footer.html`) displays "Error monitoring sponsored by Sentry" linking to `https://sentry.io`.

- **Reported**: uncaught Worker exceptions and sampled request traces (`tracesSampleRate: 0.1` when `SENTRY_DSN` is set, `0` when unset; `environment: "production"`; `release` = git short SHA injected via `--var SENTRY_RELEASE:<sha>`).
- **Source maps (`make release`)**: `scripts/release.ts` reads upload-only Sentry credentials from `~/.config/ofl/sentry.env` on the build host by path only (`SENTRY_AUTH_TOKEN`, plus optional `SENTRY_ORG` defaulting to `open-frontier-labs`, `SENTRY_PROJECT_WEBSITE`/`SENTRY_PROJECT` defaulting to `website`, and `SENTRY_URL` defaulting to `https://sentry.io/`). On fleet builds, sync that file by path (`heavy-build-route --release --needs-path ~/.config/ofl/sentry.env`). When present, `scripts/release.ts` dry-run bundles to `.wrangler/sentry-dist`, injects debug IDs via `@sentry/cli`, deploys that `--no-bundle` output, creates/uploads/finalizes the Sentry release, and cleans up `.wrangler/sentry-dist`. If `~/.config/ofl/sentry.env` or `SENTRY_AUTH_TOKEN` is absent, sourcemap upload is skipped with a warning and the Worker deploy still runs.
- **PII policy and scrubbing (`worker/sentry.ts`)**: `dataCollection` sets `userInfo: false`, `cookies: false`, `httpBodies: []`, `httpHeaders.response: false`, `urlQueryParams: false`, `databaseQueryData: false`, and denies request headers `authorization`, `cookie`, `set-cookie`, `cf-connecting-ip`, `true-client-ip`, `x-forwarded-for`, `x-real-ip`, `x-client-ip`, `x-sentry-test`, `forwarded`, `via`, and `referer`. `httpServerIntegration` sets `maxRequestBodySize: "none"`. `beforeSend` (`scrubEvent`) deletes `event.user` and `request.data`/`cookies`/`env`/`query_string`, drops those denied headers plus `x-api-key` and `proxy-authorization`, replaces email addresses with `[email]`, and filters keys matching `email|cookie|auth|token|secret|password|passwd|pwd|jwt|bearer|session|sid|body|ip_address|client_ip|remote_addr` as `[Filtered]` (deleting matching `contexts` keys). `beforeSendSpan` (`scrubSpan`) drops `client.address`, `network.peer.address`, `url.query`, `user.email`, `user.id`, and `http.request.header.<denied>` attributes and redacts email strings in span attributes. In Sentry, the `website` project setting **Prevent Storing of IP Addresses** is enabled.
- **Secrets, rotation, and disabling**: set or rotate `SENTRY_DSN` and `SENTRY_TEST_KEY` with `wrangler secret put` (names only; never commit or log values). Remove `SENTRY_DSN` (`wrangler secret delete SENTRY_DSN`) to disable Sentry reporting (`enabled: false`) and tracing (`tracesSampleRate: 0`); remove `SENTRY_TEST_KEY` (`wrangler secret delete SENTRY_TEST_KEY`) to disable the test probe.
- **Verification probe**: `/__sentry-test` (in `run_worker_first`) returns the normal 404 page unless `GET /__sentry-test` carries an `x-sentry-test` header matching `SENTRY_TEST_KEY` (constant-time SHA-256 comparison via `secretMatches`), in which case it throws `Error("ofl sentry test")`. Non-GET requests also return 404.

Brand tokens (`src/styles.css`): Frontier Green `#66E36E`, Compute Green `#1B7F46`, Graphite `#0B0E0D`, Silver Gray `#6B7177` (decor only; body text uses the lighter `#A1A8AD` for AA contrast), Soft White `#F5F7F6`. Font: Inter variable, self-hosted.

Commits need a DCO sign-off (`git commit -s`).

Licence: Apache-2.0.

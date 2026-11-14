import type { ErrorEvent } from "@sentry/cloudflare";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { scrubEvent, scrubSpan, sentryOptions } from "../worker/sentry";

interface WorkerDefault {
  fetch: (req: Request, env: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<Response>;
}

const assets404 = () => Promise.resolve(new Response("Not found", { status: 404 }));
const makeEnv = (testKey?: string): Record<string, unknown> => ({
  ASSETS: { fetch: assets404 },
  DB: {},
  APP_ORIGIN: "https://openfrontier-labs.com",
  SESSION_SECRET: crypto.randomUUID(),
  ADMIN_GITHUB_LOGINS: "bradlishman",
  SENTRY_TEST_KEY: testKey,
});
const noopCtx: Record<string, unknown> = { waitUntil: () => {}, passThroughOnException: () => {} };

function isWorkerDefault(v: unknown): v is WorkerDefault {
  return v !== null && typeof v === "object" && "fetch" in v && typeof v.fetch === "function";
}

// worker/index.ts uses @cloudflare/workers-types ambient globals (checked by `tsc -p worker`),
// while root tsconfig uses `types: ["bun"]`; runtime URL import avoids pulling Worker globals into root tsc.
async function loadWorker(): Promise<WorkerDefault> {
  const root = join(import.meta.dir, "..");
  if (!existsSync(join(root, "worker/assets.gen.ts"))) {
    const res = Bun.spawnSync(["bun", join(root, "scripts/build.ts")], {
      cwd: root,
      stderr: "inherit",
      env: { ...process.env, OFL_GITHUB_FIXTURE: join(root, "tests/fixtures/github.json") },
    });
    if (res.exitCode !== 0) throw new Error("build failed");
  }
  const mod: unknown = await import(new URL("../worker/index.ts", import.meta.url).href);
  if (mod !== null && typeof mod === "object" && "default" in mod && isWorkerDefault(mod.default)) {
    return mod.default;
  }
  throw new Error("worker/index.ts did not export default.fetch");
}

describe("sentryOptions", () => {
  test("disables reporting when SENTRY_DSN is absent", () => {
    const opts = sentryOptions({});
    expect(opts.enabled).toBe(false);
    expect(opts.dsn).toBeUndefined();
    expect(opts.tracesSampleRate).toBe(0);
    expect(opts.environment).toBe("production");
  });

  test("configures production, release, sampling, and PII minimization when SENTRY_DSN is set", () => {
    const opts = sentryOptions({ SENTRY_DSN: "https://abc@o1.ingest.sentry.io/2", SENTRY_RELEASE: "abc1234" });
    expect(opts.enabled).toBe(true);
    expect(opts.dsn).toBe("https://abc@o1.ingest.sentry.io/2");
    expect(opts.release).toBe("abc1234");
    expect(opts.environment).toBe("production");
    expect(opts.tracesSampleRate).toBe(0.1);
    expect(opts.dataCollection?.userInfo).toBe(false);
    expect(opts.dataCollection?.cookies).toBe(false);
    expect(opts.dataCollection?.httpBodies).toEqual([]);
    expect(opts.dataCollection?.urlQueryParams).toBe(false);
    expect(opts.dataCollection?.databaseQueryData).toBe(false);
  });
});

describe("PII scrubbing", () => {
  test("scrubEvent strips user, bodies, cookies, auth/IP headers, and query strings", () => {
    const dirty: ErrorEvent = {
      type: undefined,
      user: { id: "42", email: "alice@example.com", ip_address: "203.0.113.5", username: "alice" },
      request: {
        url: "https://openfrontier-labs.com/join/questionnaire",
        method: "POST",
        data: "email=alice%40example.com&displayName=Alice",
        cookies: { "__Host-ofl_session": "secret-session-value" },
        query_string: "code=oauth-code&state=oauth-state",
        env: { REMOTE_ADDR: "203.0.113.5" },
        headers: {
          authorization: "Bearer secret-token",
          cookie: "__Host-ofl_session=secret-session-value",
          "cf-connecting-ip": "203.0.113.5",
          "cf-connecting-ipv6": "2001:db8::1",
          "cf-pseudo-ipv4": "240.0.0.1",
          "x-forwarded-for": "203.0.113.5",
          "x-real-ip": "203.0.113.5",
          "x-sentry-test": "secret-test-key",
          referer: "https://openfrontier-labs.com/admin/review?q=alice%40example.com",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "test-agent",
        },
      },
    };

    const clean = scrubEvent(dirty);
    expect(clean.user).toBeUndefined();
    const req = clean.request;
    expect(req).toBeDefined();
    if (!req) return;
    expect(req.data).toBeUndefined();
    expect(req.cookies).toBeUndefined();
    expect(req.query_string).toBeUndefined();
    expect(req.env).toBeUndefined();
    expect(req.headers).toEqual({
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "test-agent",
    });
  });

  test("scrubEvent redacts emails and sensitive keys in messages, exceptions, breadcrumbs, and extra", () => {
    const dirty: ErrorEvent = {
      type: undefined,
      message: "Signup failed for alice@example.com",
      exception: {
        values: [{ type: "Error", value: "duplicate key for bob@example.org" }],
      },
      breadcrumbs: [
        {
          message: "POST from carol@example.net",
          data: { email: "carol@example.net", note: "sent to carol@example.net", ok: 1 },
        },
      ],
      extra: {
        ip_address: "198.51.100.2",
        detail: "contact dave@example.io",
      },
    };

    const clean = scrubEvent(dirty);
    expect(clean.message).toBe("Signup failed for [email]");
    expect(clean.exception?.values?.[0]?.value).toBe("duplicate key for [email]");
    expect(clean.breadcrumbs?.[0]?.message).toBe("POST from [email]");
    expect(clean.breadcrumbs?.[0]?.data).toEqual({ email: "[Filtered]", note: "sent to [email]", ok: 1 });
    expect(clean.extra).toEqual({ ip_address: "[Filtered]", detail: "contact [email]" });
  });

  test("scrubSpan removes sensitive network and header attributes", () => {
    const input: { attributes: Record<string, unknown> } = {
      attributes: {
        "http.request.method": "GET",
        "client.address": "203.0.113.5",
        "http.request.header.cf-connecting-ipv6": ["2001:db8::1"],
        "http.request.header.cf-pseudo-ipv4": ["240.0.0.1"],
        "http.request.header.authorization": ["Bearer tok"],
        "http.request.header.cookie": ["sid=1"],
        "http.request.header.referer": ["https://openfrontier-labs.com/admin/review?q=alice%40example.com"],
        "http.request.header.user-agent": ["crawler alice@example.com"],
        "url.query": "?code=abc",
        "custom.note": "user@example.com",
      },
    };
    const span = scrubSpan(input);
    expect(span.attributes).toEqual({
      "http.request.method": "GET",
      "http.request.header.user-agent": ["crawler [email]"],
      "custom.note": "[email]",
    });
  });
});

describe("/__sentry-test route", () => {
  test("returns 404 when x-sentry-test header is absent", async () => {
    const worker = await loadWorker();
    const res = await worker.fetch(new Request("https://openfrontier-labs.com/__sentry-test"), makeEnv("expected-key"), noopCtx);
    expect(res.status).toBe(404);
  });

  test("returns 404 when x-sentry-test header is wrong", async () => {
    const worker = await loadWorker();
    const res = await worker.fetch(
      new Request("https://openfrontier-labs.com/__sentry-test", { headers: { "x-sentry-test": "wrong-key" } }),
      makeEnv("expected-key"),
      noopCtx,
    );
    expect(res.status).toBe(404);
  });

  test("returns 404 when SENTRY_TEST_KEY secret is unset", async () => {
    const worker = await loadWorker();
    const res = await worker.fetch(
      new Request("https://openfrontier-labs.com/__sentry-test", { headers: { "x-sentry-test": "anything" } }),
      makeEnv(undefined),
      noopCtx,
    );
    expect(res.status).toBe(404);
  });

  test('throws Error("ofl sentry test") when x-sentry-test matches SENTRY_TEST_KEY', async () => {
    const worker = await loadWorker();
    let caught: unknown = null;
    try {
      await worker.fetch(
        new Request("https://openfrontier-labs.com/__sentry-test", { headers: { "x-sentry-test": "expected-key" } }),
        makeEnv("expected-key"),
        noopCtx,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    if (caught instanceof Error) expect(caught.message).toBe("ofl sentry test");
  });

  test("does not trigger probe on non-GET requests", async () => {
    const worker = await loadWorker();
    const res = await worker.fetch(
      new Request("https://openfrontier-labs.com/__sentry-test", {
        method: "POST",
        headers: { "x-sentry-test": "expected-key", "sec-fetch-site": "same-origin" },
      }),
      makeEnv("expected-key"),
      noopCtx,
    );
    expect(res.status).toBe(404);
  });
});

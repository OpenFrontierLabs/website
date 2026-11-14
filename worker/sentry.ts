import * as Sentry from "@sentry/cloudflare";
import type { ErrorEvent } from "@sentry/cloudflare";

export interface SentryEnv {
  SENTRY_DSN?: string;
  SENTRY_RELEASE?: string;
}

const SENSITIVE_HEADER =
  /^(authorization|cookie|set-cookie|cf-connecting-ip|true-client-ip|x-forwarded-for|x-real-ip|x-client-ip|x-sentry-test|forwarded|via|x-api-key|proxy-authorization)$/i;
const SENSITIVE_KEY =
  /email|cookie|auth|token|secret|password|passwd|pwd|jwt|bearer|session|sid|body|ip_address|client_ip|remote_addr/i;
const SENSITIVE_SPAN_ATTR =
  /^(client\.address|network\.peer\.address|url\.query|user\.email|user\.id|http\.request\.header\.(authorization|cookie|set-cookie|cf-connecting-ip|true-client-ip|x-forwarded-for|x-real-ip|x-client-ip|x-sentry-test|forwarded|via))$/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const scrubEmails = (s: string): string => s.replace(EMAIL_RE, "[email]");

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubEmails(value);
  if (depth >= 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? "[Filtered]" : scrubValue(v, depth + 1);
  }
  return out;
}

function scrubRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = SENSITIVE_KEY.test(k) ? "[Filtered]" : scrubValue(v, 1);
  }
  return out;
}

function scrubHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!SENSITIVE_HEADER.test(k)) out[k] = scrubEmails(v);
  }
  return out;
}

function scrubRequest(req: NonNullable<ErrorEvent["request"]>): void {
  delete req.data;
  delete req.cookies;
  delete req.env;
  delete req.query_string;
  req.headers = scrubHeaders(req.headers);
}

function scrubExceptionAndBreadcrumbs(event: ErrorEvent): void {
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === "string") ex.value = scrubEmails(ex.value);
  }
  for (const b of event.breadcrumbs ?? []) {
    if (typeof b.message === "string") b.message = scrubEmails(b.message);
    if (isPlainRecord(b.data)) b.data = scrubRecord(b.data);
  }
}

/** Strips IPs, emails, cookies, auth headers and request bodies before an event leaves the Worker. */
export function scrubEvent<T extends ErrorEvent>(event: T): T {
  delete event.user;
  if (event.request) scrubRequest(event.request);
  if (typeof event.message === "string") event.message = scrubEmails(event.message);
  scrubExceptionAndBreadcrumbs(event);
  if (isPlainRecord(event.extra)) event.extra = scrubRecord(event.extra);
  if (event.contexts) {
    for (const [k, v] of Object.entries(event.contexts)) {
      if (SENSITIVE_KEY.test(k)) delete event.contexts[k];
      else if (isPlainRecord(v)) event.contexts[k] = scrubRecord(v);
    }
  }
  return event;
}

export function scrubSpan<T extends { attributes?: Record<string, unknown> }>(span: T): T {
  if (!span.attributes) return span;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(span.attributes)) {
    if (SENSITIVE_SPAN_ATTR.test(k)) continue;
    clean[k] = typeof v === "string" ? scrubEmails(v) : v;
  }
  span.attributes = clean;
  return span;
}

/** Constant-time string check: hashes both sides with SHA-256 first so length never leaks. */
export async function secretMatches(given: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(secret)),
  ]);
  const av = new Uint8Array(a);
  const bv = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= (av[i] ?? 0) ^ (bv[i] ?? 0);
  return diff === 0;
}

export function sentryOptions(env: SentryEnv): Sentry.CloudflareOptions {
  const rawDsn = env.SENTRY_DSN?.trim() ?? "";
  const rawRelease = env.SENTRY_RELEASE?.trim() ?? "";
  const dsn = rawDsn.length > 0 ? rawDsn : undefined;
  const release = rawRelease.length > 0 ? rawRelease : undefined;
  return {
    dsn,
    enabled: dsn !== undefined,
    release,
    environment: "production",
    tracesSampleRate: dsn !== undefined ? 0.1 : 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      httpHeaders: {
        request: {
          deny: [
            "authorization",
            "cookie",
            "set-cookie",
            "cf-connecting-ip",
            "true-client-ip",
            "x-forwarded-for",
            "x-real-ip",
            "x-client-ip",
            "x-sentry-test",
            "forwarded",
            "via",
          ],
        },
        response: false,
      },
      urlQueryParams: false,
      databaseQueryData: false,
    },
    integrations: (defaults) =>
      defaults.map((i) => (i.name === "HttpServer" ? Sentry.httpServerIntegration({ maxRequestBodySize: "none" }) : i)),
    beforeSend: (event) => scrubEvent(event),
    beforeSendSpan: (span) => scrubSpan(span),
  };
}

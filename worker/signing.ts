// Signed values (HMAC-SHA256) for the session cookie and the OAuth state cookie.
const enc = new TextEncoder();

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

/** `payload.signature`, payload = base64url JSON carrying `exp` (unix seconds). */
export async function sign(value: object, secret: string, ttlSeconds: number, now = Date.now()): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ ...value, exp: Math.floor(now / 1000) + ttlSeconds })));
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

/** The signed object, or null when tampered, malformed or expired. */
export async function verify<T>(token: string | undefined, secret: string, now = Date.now()): Promise<T | null> {
  const [payload, sig, extra] = token?.split(".") ?? [];
  if (!payload || !sig || extra !== undefined) return null;
  try {
    if (!equal(fromB64url(sig), await hmac(secret, payload))) return null;
    const value = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as T & { exp?: unknown };
    if (typeof value.exp !== "number" || value.exp * 1000 <= now) return null;
    return value;
  } catch {
    return null;
  }
}

export interface Session {
  uid: number;
  login: string;
}
export const SESSION_TTL = 60 * 60 * 24 * 30;
export const STATE_TTL = 600;

export const signSession = (s: Session, secret: string, now?: number) =>
  sign({ uid: s.uid, login: s.login }, secret, SESSION_TTL, now);

export async function readSession(token: string | undefined, secret: string, now?: number): Promise<Session | null> {
  const v = await verify<Partial<Session>>(token, secret, now);
  return v && typeof v.uid === "number" && typeof v.login === "string" ? { uid: v.uid, login: v.login } : null;
}

/** OAuth state: the state sent to GitHub must equal the one in our signed, unexpired cookie. */
export async function stateMatches(cookie: string | undefined, returned: string | null, secret: string, now?: number): Promise<boolean> {
  if (!returned) return false;
  const v = await verify<{ state?: unknown }>(cookie, secret, now);
  return typeof v?.state === "string" && equal(enc.encode(v.state), enc.encode(returned));
}

export function cookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of header?.split(";") ?? []) {
    const i = part.indexOf("=");
    if (i > 0) out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}

export const setCookie = (name: string, value: string, maxAge: number, path = "/") =>
  `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

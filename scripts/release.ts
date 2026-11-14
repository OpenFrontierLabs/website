/**
 * Production release helper for `make release`:
 * 1. Reads Sentry credentials from ~/.config/ofl/sentry.env if present (skips sourcemaps with a warning if absent).
 * 2. Applies remote D1 migrations and deploys the Worker with SENTRY_RELEASE=<git short SHA> via the CF token broker.
 * 3. Injects debug IDs and uploads sourcemaps for that exact bundle to Sentry when credentials are present.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const envPath = join(homedir(), ".config/ofl/sentry.env");
const outDir = join(root, ".wrangler/sentry-dist");
const sentryCli = join(root, "node_modules/.bin/sentry-cli");
const wrangler = join(root, "node_modules/.bin/wrangler");

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const stripped = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = stripped.indexOf("=");
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    let val = stripped.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function firstNonEmpty(...values: (string | undefined)[]): string {
  for (const v of values) {
    if (v !== undefined && v.length > 0) return v;
  }
  return "";
}

function run(cmd: string[], extraEnv: Record<string, string | undefined> = {}): string {
  const res = Bun.spawnSync(cmd, {
    cwd: root,
    stdio: ["inherit", "pipe", "inherit"],
    env: { ...process.env, ...extraEnv },
  });
  if (res.exitCode !== 0) {
    throw new Error(`Command failed (${res.exitCode}): ${cmd.join(" ")}`);
  }
  const stdout = res.stdout.toString();
  if (stdout.length > 0) process.stdout.write(stdout);
  return stdout.trim();
}

const shaRes = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: root, stdout: "pipe", stderr: "inherit" });
if (shaRes.exitCode !== 0) throw new Error("git rev-parse --short HEAD failed");
const release = shaRes.stdout.toString().trim();
if (release.length === 0) throw new Error("Empty git short SHA");

let sentryEnv: Record<string, string> | null = null;
if (existsSync(envPath)) {
  const parsed = parseEnvFile(envPath);
  const authToken = firstNonEmpty(parsed.SENTRY_AUTH_TOKEN, process.env.SENTRY_AUTH_TOKEN);
  const org = firstNonEmpty(parsed.SENTRY_ORG, process.env.SENTRY_ORG, "open-frontier-labs");
  const project = firstNonEmpty(parsed.SENTRY_PROJECT_WEBSITE, parsed.SENTRY_PROJECT, process.env.SENTRY_PROJECT, "website");
  const url = firstNonEmpty(parsed.SENTRY_URL, process.env.SENTRY_URL, "https://sentry.io/");
  if (authToken.length > 0) {
    sentryEnv = { SENTRY_AUTH_TOKEN: authToken, SENTRY_ORG: org, SENTRY_PROJECT: project, SENTRY_URL: url };
  } else {
    process.stderr.write(`WARNING: ${envPath} has no SENTRY_AUTH_TOKEN; skipping Sentry sourcemap upload.\n`);
  }
} else {
  process.stderr.write(`WARNING: ${envPath} not found; skipping Sentry sourcemap upload.\n`);
}

run(["bun", "scripts/with-cf-deploy-token.ts", "--", wrangler, "d1", "migrations", "apply", "ofl-waitlist", "--remote"]);

rmSync(outDir, { recursive: true, force: true });
try {
  if (sentryEnv !== null) {
    run([wrangler, "deploy", "--dry-run", "--outdir", outDir, "--upload-source-maps", "--var", `SENTRY_RELEASE:${release}`]);
    run([sentryCli, "sourcemaps", "inject", outDir]);
    run([
      "bun",
      "scripts/with-cf-deploy-token.ts",
      "--",
      wrangler,
      "deploy",
      join(outDir, "index.js"),
      "-c",
      "wrangler.toml",
      "--no-bundle",
      "--upload-source-maps",
      "--var",
      `SENTRY_RELEASE:${release}`,
    ]);
    run([sentryCli, "releases", "new", release], sentryEnv);
    run([sentryCli, "sourcemaps", "upload", "--release", release, outDir], sentryEnv);
    run([sentryCli, "releases", "finalize", release], sentryEnv);
  } else {
    run(["bun", "scripts/with-cf-deploy-token.ts", "--", wrangler, "deploy", "--upload-source-maps", "--var", `SENTRY_RELEASE:${release}`]);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

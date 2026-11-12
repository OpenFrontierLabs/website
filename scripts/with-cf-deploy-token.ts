/**
 * Run one command with a short-lived Cloudflare deploy token.
 *
 * Mints a token from the ms-01 broker (tools/cf-token-broker in the fudopro repo, venture
 * "ofl") scoped to the permissions below, locked to this host's egress addresses and expiring
 * after TOKEN_TTL_SECONDS; runs the command with it as CLOUDFLARE_API_TOKEN; revokes it on
 * exit. No Cloudflare credential is stored on the host.
 *
 * Usage: bun scripts/with-cf-deploy-token.ts -- <command...>   (make release uses it)
 * Broker host: OFL_CF_BROKER_SSH (default "ssh -o BatchMode=yes -p 2222 adreno@100.94.181.78").
 */
import { spawn, spawnSync } from "node:child_process";

const ACCOUNT_ID = "33c61b47c5fc29b1602641062bb4a58d";
const ZONE_ID = "2d031daf0b2e8c71a8a597c4eac23826"; // openfrontier-labs.com
const TOKEN_TTL_SECONDS = 60 * 60;
const BROKER_SSH = (process.env.OFL_CF_BROKER_SSH ?? "ssh -o BatchMode=yes -o ConnectTimeout=15 -p 2222 adreno@100.94.181.78").split(" ");
const TRACE_URLS = ["https://1.1.1.1/cdn-cgi/trace", "https://www.cloudflare.com/cdn-cgi/trace"];

/** Account Settings Read, Workers Scripts Write, D1 Read, D1 Metadata Read, D1 Write (ofl-waitlist migrations). */
const ACCOUNT_PERMISSIONS = [
  "c1fde68c7bcc44588cbb6ddbc16d6480",
  "e086da7e2179491d91ee5f35b3ca210a",
  "192192df92ee43ac90f2aeeffce67e35",
  "5b4da8a35efa4fe8be684070183cdb32",
  "09b2857d1c31407795e75e3fed8617a1",
];
/** Zone Read, Workers Routes Write, DNS Write (the apex and www custom domains). */
const ZONE_PERMISSIONS = ["c8fed203ed3043cba015a93ad1616f1f", "28f4b596e7d643029c524985477ae49a", "4755a26eedb94da69e1066d98aa820be"];

function broker(args: string[], input?: string): string {
  const [command = "ssh", ...rest] = BROKER_SSH;
  const result = spawnSync(command, [...rest, "bin/cf-token-broker", ...args], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`cf-token-broker ${args[0] ?? ""} failed (${String(result.status)}): ${result.stderr}`);
  return result.stdout;
}

// Probe each address family explicitly: a token locked to only the family fetch happened to use is
// rejected when wrangler connects over the other one on a dual-stack host (fudopro #1968).
async function egressAddresses(): Promise<string[]> {
  const probes = TRACE_URLS.flatMap((url) =>
    (["-4", "-6"] as const).map(async (family) => {
      const out = await Bun.$`curl -s ${family} --max-time 5 ${url}`.nothrow().quiet().text();
      const ip = /^ip=(.+)$/mu.exec(out)?.[1]?.trim();
      if (!ip) return null;
      return ip.includes(":") ? `${ip}/128` : `${ip}/32`;
    }),
  );
  const addresses = [...new Set((await Promise.all(probes)).filter((value): value is string => value !== null))];
  if (addresses.length === 0) throw new Error("could not determine this host's egress address");
  return addresses;
}

const command = process.argv[2] === "--" ? process.argv.slice(3) : process.argv.slice(2);
if (command.length === 0) {
  console.error("usage: bun scripts/with-cf-deploy-token.ts -- <command...>");
  process.exit(2);
}

const root = "com.cloudflare.api";
const requestIps = await egressAddresses();
const minted = JSON.parse(
  broker(
    ["mint"],
    JSON.stringify({
      name: "ofl-deploy release",
      policies: [
        { effect: "allow", resources: { [`${root}.account.${ACCOUNT_ID}`]: "*" }, permission_groups: ACCOUNT_PERMISSIONS.map((id) => ({ id })) },
        { effect: "allow", resources: { [`${root}.account.zone.${ZONE_ID}`]: "*" }, permission_groups: ZONE_PERMISSIONS.map((id) => ({ id })) },
      ],
      requestIps,
      ttlSeconds: TOKEN_TTL_SECONDS,
    }),
  ),
) as { id?: string; value?: string; expiresOn?: string };
if (!minted.id || !minted.value) throw new Error("cf-token-broker returned no token id or value");
const { id, value } = minted;
console.error(`cf deploy token ${id} minted for ${requestIps.length} egress address(es), IPv4 and IPv6 as present (expires ${minted.expiresOn ?? "?"})`);

let code = 1;
try {
  // A new token's permissions apply per product, seconds apart: wait until both D1 (the migrations run
  // first) and Workers answer, or the release fails with "Authentication error [code: 10000]".
  const probes = [`accounts/${ACCOUNT_ID}/d1/database?per_page=1`, `accounts/${ACCOUNT_ID}/workers/scripts`];
  let effective = false;
  for (let attempt = 0; attempt < 30 && !effective; attempt += 1) {
    const answers = await Promise.all(
      probes.map((path) => fetch(`https://api.cloudflare.com/client/v4/${path}`, { headers: { authorization: `Bearer ${value}` }, signal: AbortSignal.timeout(10_000) })),
    );
    effective = answers.every((res) => res.ok);
    if (!effective) await Bun.sleep(2000);
  }
  if (!effective) throw new Error("the minted Cloudflare token never became effective for D1 and Workers");

  const [program = "", ...args] = command;
  const child = spawn(program, args, { stdio: "inherit", env: { ...process.env, CLOUDFLARE_API_TOKEN: value, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID } });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  const exited = Promise.withResolvers<number>();
  child.on("exit", (status, signal) => exited.resolve(status ?? (signal === null ? 1 : 128)));
  child.on("error", () => exited.resolve(127));
  code = await exited.promise;
} finally {
  try {
    broker(["revoke", id, "ofl"]);
  } catch (error) {
    console.error(`revoke failed; token expires on its own: ${String(error)}`);
  }
}
process.exit(code);

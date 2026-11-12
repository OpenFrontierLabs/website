import { describe, expect, test } from "bun:test";
import { isOperator } from "../worker/github";
import { validateAnswers } from "../worker/questionnaire";
import { readSession, sign, signSession, stateMatches } from "../worker/signing";
import { DISCORD_URL, issueSearch, PATHS, pathsFor } from "../worker/starter";

const SECRET = crypto.randomUUID();
const OTHER = crypto.randomUUID();
const T0 = Date.UTC(2026, 10, 12);

describe("OAuth state", () => {
  test("accepts only the state in our own signed, unexpired cookie", async () => {
    const cookie = await sign({ state: "abc123" }, SECRET, 600, T0);
    expect(await stateMatches(cookie, "abc123", SECRET, T0 + 1000)).toBe(true);
    expect(await stateMatches(cookie, "abc124", SECRET, T0 + 1000)).toBe(false);
    expect(await stateMatches(cookie, null, SECRET, T0 + 1000)).toBe(false);
    expect(await stateMatches(undefined, "abc123", SECRET, T0)).toBe(false);
    expect(await stateMatches(cookie, "abc123", OTHER, T0 + 1000)).toBe(false);
    expect(await stateMatches(cookie, "abc123", SECRET, T0 + 601_000)).toBe(false);
  });
});

describe("session signing", () => {
  test("round-trips and rejects tampering, foreign keys and expiry", async () => {
    const token = await signSession({ uid: 7, login: "octo" }, SECRET, T0);
    expect(await readSession(token, SECRET, T0 + 1000)).toEqual({ uid: 7, login: "octo" });
    expect(await readSession(token, OTHER, T0 + 1000)).toBeNull();
    expect(await readSession(token, SECRET, T0 + 31 * 86_400_000)).toBeNull();

    const [payload, sig] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ uid: 1, login: "admin", exp: 9e9 })).toString("base64url");
    expect(await readSession(`${forged}.${sig}`, SECRET, T0)).toBeNull();
    expect(await readSession(`${payload}.${sig.slice(0, -2)}AA`, SECRET, T0)).toBeNull();
    expect(await readSession(`${payload}.${sig}.x`, SECRET, T0)).toBeNull();
    expect(await readSession("garbage", SECRET, T0)).toBeNull();
  });
});

describe("operator authorisation", () => {
  test("org admins and listed logins only", () => {
    expect(isOperator("someone", "admin", "")).toBe(true);
    expect(isOperator("someone", "member", "bradlishman")).toBe(false);
    expect(isOperator("someone", null, "bradlishman")).toBe(false);
    expect(isOperator("BradLishman", null, "alice, bradlishman")).toBe(true);
    expect(isOperator("", null, "alice,,")).toBe(false);
    expect(isOperator("brad", null, "bradlishman")).toBe(false);
  });
});

const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

describe("questionnaire validator", () => {
  test("accepts a full, valid answer set and cleans it", () => {
    const { answers, errors } = validateAnswers(
      form([
        ["displayName", "  Ada  "],
        ["email", "ada@example.com"],
        ["location", "Japan, UTC+9"],
        ["contributions", "compute"],
        ["contributions", "code"],
        ["contributions", "code"],
        ["hw_nvidia_consumer", "2"],
        ["hw_apple", "0"],
        ["gpuDetails", "2x RTX 4090"],
        ["hoursPerWeek", "10"],
        ["experience", "researcher"],
        ["links", "https://ada.dev\nhttps://huggingface.co/ada"],
        ["why", "Open models"],
        ["heardFrom", "X"],
        ["consent", "on"],
      ]),
    );
    expect(errors).toEqual({});
    expect(answers.displayName).toBe("Ada");
    expect(answers.contributions).toEqual(["compute", "code"]);
    expect(answers.hardware).toEqual({ nvidia_consumer: 2 });
    expect(answers.hoursPerWeek).toBe(10);
    expect(answers.links).toEqual(["https://ada.dev", "https://huggingface.co/ada"]);
    expect(answers.consent).toBe(true);
  });

  test("only the name is required", () => {
    expect(validateAnswers(form([["displayName", "Ada"]])).errors).toEqual({});
    expect(Object.keys(validateAnswers(form([])).errors)).toEqual(["displayName"]);
  });

  test("rejects bad values field by field", () => {
    const { errors } = validateAnswers(
      form([
        ["displayName", "x".repeat(81)],
        ["email", "not-an-email"],
        ["contributions", "lobbying"],
        ["hw_amd", "-1"],
        ["hoursPerWeek", "200"],
        ["experience", "wizard"],
        ["links", "javascript:alert(1)"],
      ]),
    );
    expect(Object.keys(errors).sort()).toEqual(["contributions", "displayName", "email", "experience", "hardware", "hoursPerWeek", "links"]);
  });

  test("None conflicts with counts; consent needs an email", () => {
    const { errors } = validateAnswers(form([["displayName", "Ada"], ["hw_none", "on"], ["hw_tpu", "1"], ["consent", "on"]]));
    expect(Object.keys(errors).sort()).toEqual(["consent", "hardware"]);
  });
});

describe("starter issues after the questionnaire", () => {
  test("answers map to their contributor paths, in a fixed order", () => {
    expect(pathsFor(["code"]).map((p) => p.title)).toEqual(["Rust and P2P", "Web"]);
    expect(pathsFor(["funding", "compute", "research"]).map((p) => p.title)).toEqual(["Compute donor", "ML training", "Funding"]);
    expect(pathsFor(["data", "evals", "community"]).map((p) => p.title)).toEqual(["Data", "Evals", "Docs and community"]);
    expect(pathsFor([])).toEqual(Object.values(PATHS));
  });

  test("issue links are live good-first-issue searches with the path's label, never issue numbers", () => {
    const url = new URL(issueSearch("area/rust"));
    expect(url.origin + url.pathname).toBe("https://github.com/OpenFrontierLabs/openfrontier/issues");
    expect(url.searchParams.get("q")).toBe('is:issue is:open label:"good first issue" label:"area/rust"');
    for (const p of Object.values(PATHS)) {
      expect(p.href).not.toMatch(/\/issues\/\d/);
      if (p.href.includes("/issues?")) expect(new URL(p.href).searchParams.get("q")).toMatch(/^is:issue is:open label:"good first issue" label:"(?:area|layer)\/[\w-]+"$/);
    }
    expect(DISCORD_URL).toBe("https://discord.gg/M4sD8T5M8D");
  });
});

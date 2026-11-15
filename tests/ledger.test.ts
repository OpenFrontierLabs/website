import { describe, expect, test } from "bun:test";
import { type LedgerFile, renderCompute } from "../scripts/ledger";

const file = (name: string, data: Partial<LedgerFile["data"]> & { nodes: LedgerFile["data"]["nodes"] }): LedgerFile => ({
  name,
  path: `ledger/${name}`,
  data: { run: "run0", ...data },
});
const node = (github_handle: string, gpu_hours: number) => ({ github_handle, gpu_hours });
const handlesIn = (html: string) => [...html.matchAll(/<td>\d+<\/td><td><a href="https:\/\/github\.com\/([^"]+)"[^>]*>([^<]+)<\/a><\/td><td>([^<]+)<\/td>/g)].map((m) => [m[1], m[2], m[3]]);

describe("renderCompute", () => {
  test("lists every handle of every real file, ranked by summed GPU-hours across files and nodes", () => {
    const html = renderCompute([
      file("run0-2027-01.json", { nodes: [node("alice", 10), node("bob-2", 30.26), node("alice", 5)] }),
      file("run1-2027-03.json", { run: "run1", nodes: [node("carol", 100), node("alice", 1)] }),
    ]);
    expect(handlesIn(html)).toEqual([
      ["carol", "carol", "100"],
      ["bob-2", "bob-2", "30.3"],
      ["alice", "alice", "16"],
    ]);
    expect(html).toContain("run0-2027-01.json</a>, <a");
    expect(html).toContain('blob/main/ledger/run1-2027-03.json"');
    expect(html).not.toContain("No compute has been donated yet");
  });

  test("accepts the longest and the shortest valid handles; one person under two spellings is one row", () => {
    const longest = `a${"b".repeat(18)}-${"c".repeat(19)}`;
    expect(longest).toHaveLength(39);
    const html = renderCompute([file("run0-2027-01.json", { nodes: [node(longest, 1), node("x", 2), node("Octo-Cat", 3), node("octo-cat", 4)] })]);
    expect(handlesIn(html)).toEqual([
      ["Octo-Cat", "Octo-Cat", "7"],
      ["x", "x", "2"],
      [longest, longest, "1"],
    ]);
  });

  test("example files never render: not by name, not by flag, not with real-looking handles", () => {
    const nodes = [node("example-handle-one", 168), node("realperson", 24.5)];
    const byName = file("example.EXAMPLE.json", { nodes, islands: [{ id: "i", name: "Example Island", donor: "Example Donor" }] });
    const byFlag = file("run0-2000-01.json", { example: true, nodes });
    for (const examples of [[byName], [byFlag], [byName, byFlag]]) {
      const html = renderCompute(examples);
      expect(html).toContain("No compute has been donated yet");
      expect(html).not.toMatch(/<table|example-handle|realperson|Example Donor|Example Island|EXAMPLE/);
    }
    const mixed = renderCompute([byName, byFlag, file("run0-2027-01.json", { nodes: [node("alice", 2)] })]);
    expect(handlesIn(mixed).map((r) => r[0])).toEqual(["alice"]);
    expect(mixed).not.toMatch(/example|EXAMPLE|Example/);
  });

  test("honest empty state when there are no ledger files or no nodes", () => {
    for (const files of [[], [file("run0-2027-01.json", { nodes: [] })]]) {
      const html = renderCompute(files);
      expect(html).toContain("No compute has been donated yet");
      expect(html).toContain("<span class=\"tag\">Planned</span>");
      expect(html).not.toMatch(/<table|GPU-hours<\/th>/);
    }
  });

  test("renders only handle, GPU-hours and run: no money or other fields a file might carry", () => {
    const rich = file("run0-2027-01.json", {
      nodes: [{ github_handle: "alice", gpu_hours: 12, usd: 98765, donation: "$4321", email: "a@example.org", tokens_processed: 777000111 } as never],
    });
    const html = renderCompute([rich]);
    for (const leak of ["98765", "4321", "$", "USD", "a@example.org", "777000111", "777,000,111"]) expect(html).not.toContain(leak);
    expect(handlesIn(html)).toEqual([["alice", "alice", "12"]]);
  });

  test("island names and donors are escaped", () => {
    const html = renderCompute([file("run0-2027-01.json", { nodes: [node("alice", 1)], islands: [{ id: "x", name: "<b>&Lab", donor: 'A "B" <i>' }] })]);
    expect(html).toContain("<b>&lt;b&gt;&amp;Lab</b>, donated by A &quot;B&quot; &lt;i&gt; (run0)");
    expect(html).not.toContain("<i>");
  });

  test.each([["bad_handle"], ["-lead"], ["trail-"], ["dou--ble"], [""], ["a".repeat(40)], ["<b>x</b>"], ["a b"], ["alice\"><script>"]])("a real file with handle %j fails the build instead of rendering", (handle) => {
    expect(() => renderCompute([file("run0-2027-01.json", { nodes: [node(handle, 1)] })])).toThrow(/invalid node/);
  });

  test.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY]])("a real file with %p GPU-hours fails the build", (hours) => {
    expect(() => renderCompute([file("run0-2027-01.json", { nodes: [node("alice", hours)] })])).toThrow(/invalid node/);
  });
});

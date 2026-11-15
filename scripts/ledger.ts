import { escapeHtml } from "./html";

/** One compute ledger file (ledger/*.json in openfrontier, schema.json aside), examples included: they are dropped by renderCompute. */
export interface LedgerFile {
  path: string;
  name: string;
  data: {
    example?: boolean;
    run: string;
    islands?: { id: string; name: string; donor: string }[];
    nodes: { github_handle: string; gpu_hours: number }[];
  };
}

// Same pattern as $defs/github_handle in openfrontier's ledger/schema.json.
const HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const LEDGER_URL = "https://github.com/OpenFrontierLabs/openfrontier/tree/main/ledger";

/**
 * The compute donors section: real ledger files only. Examples (EXAMPLE in the name, "example": true inside)
 * are never rendered. Only the GitHub handle, GPU-hours and run are read from a node, so nothing else a file
 * carries can reach the page. GitHub handles are case-insensitive, so one person is one row.
 */
export function renderCompute(files: LedgerFile[]): string {
  const real = files.filter((f) => !f.name.includes("EXAMPLE") && f.data.example !== true);
  const donors = new Map<string, { handle: string; gpuHours: number; runs: Set<string> }>();
  const islands = new Map<string, string>();
  for (const { path, data } of real) {
    for (const node of data.nodes) {
      if (!HANDLE.test(node.github_handle) || !Number.isFinite(node.gpu_hours) || node.gpu_hours < 0) throw new Error(`${path}: invalid node ${JSON.stringify(node)}`);
      const key = node.github_handle.toLowerCase();
      const donor = donors.get(key) ?? { handle: node.github_handle, gpuHours: 0, runs: new Set<string>() };
      donor.gpuHours += node.gpu_hours;
      donor.runs.add(data.run);
      donors.set(key, donor);
    }
    for (const island of data.islands ?? []) islands.set(`${data.run}/${island.id}`, `<li><b>${escapeHtml(island.name)}</b>, donated by ${escapeHtml(island.donor)} (${escapeHtml(data.run)})</li>`);
  }
  if (donors.size === 0) {
    return `<div class="gcard people-empty"><span class="tag">Planned</span><p>No compute has been donated yet: nothing has been trained, so the <a href="${LEDGER_URL}" rel="noopener">compute ledger</a> holds no real entries. When Run 0 produces its first ledger file, every node's GitHub handle and GPU-hours show here, ranked.</p></div>`;
  }
  const rows = [...donors.values()]
    .sort((a, b) => b.gpuHours - a.gpuHours || a.handle.toLowerCase().localeCompare(b.handle.toLowerCase()))
    .map((d, i) => `<tr><td>${i + 1}</td><td><a href="https://github.com/${d.handle}" rel="noopener">${d.handle}</a></td><td>${d.gpuHours.toLocaleString("en-US", { maximumFractionDigits: 1 })}</td><td>${escapeHtml([...d.runs].sort().join(", "))}</td></tr>`)
    .join("");
  const clusters = islands.size ? `<h3>Donated clusters (islands)</h3><ul class="people-islands">${[...islands.values()].join("")}</ul>` : "";
  const sources = real.map((f) => `<a href="https://github.com/OpenFrontierLabs/openfrontier/blob/main/${escapeHtml(f.path)}" rel="noopener">${escapeHtml(f.name)}</a>`).join(", ");
  return `<div class="app-table-wrap"><table class="app-table"><thead><tr><th>#</th><th>GitHub handle</th><th>GPU-hours</th><th>Runs</th></tr></thead><tbody>${rows}</tbody></table></div>${clusters}<p class="muted">From ${sources}.</p>`;
}

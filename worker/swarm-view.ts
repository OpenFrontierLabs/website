// HTML for the swarm: the live blocks of /dashboard and the member's nodes and runs in /console.
// Server-rendered, no scripts; the loss chart is SVG drawn from the reported values.
import { esc } from "./esc";
import type { LatestRun, MemberSwarm, RunRow, Summary, SwarmNode } from "./swarm";

export const PROOF_OF_CONCEPT_URL = "https://github.com/OpenFrontierLabs/openfrontier/pull/28";
export const JOIN_COMMAND = "ofl node join";

export const duration = (seconds: number): string => {
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(2)} h`;
};

const count = (n: number) => n.toLocaleString("en-US");
const loss = (n: number | null) => (n === null ? "n/a" : n.toFixed(4));
const short = (hash: string | null) => (hash ? hash.slice(0, 12) : "none yet");
const DEVICE_NAMES: Record<string, string> = { cuda: "NVIDIA (CUDA)", mps: "Apple Silicon (MPS)", rocm: "AMD (ROCm)", cpu: "CPU" };
export const deviceName = (d: string) => DEVICE_NAMES[d] ?? d.toUpperCase();

export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

const iso = (ms: number) => new Date(ms).toISOString();
const when = (ms: number) => `<time datetime="${iso(ms)}">${iso(ms).slice(0, 16).replace("T", " ")} UTC</time>`;

// ---- /dashboard --------------------------------------------------------------------------------

const stat = (icon: string, value: string, label: string, note: string) =>
  `<li><svg aria-hidden="true"><use href="#${icon}"/></svg><div><b>${esc(value)}</b><span>${esc(label)}</span></div><small>${esc(note)}</small></li>`;

export function nodesStat(s: Summary): string {
  const registered = s.totals.nodes_registered;
  return stat("i-gpu", count(s.totals.nodes_online), "Nodes online", registered === 0 ? "none joined yet" : `${count(registered)} registered`);
}

export function runsStat(s: Summary): string {
  const t = s.totals;
  return stat("i-bolt", count(t.runs), "Training runs", t.runs === 0 ? "none reported yet" : `${count(t.rounds)} rounds · ${duration(t.compute_seconds)} of node compute`);
}

const STATE_LABEL: Record<string, string> = { waiting: "Waiting for nodes", training: "Training", done: "Finished", stalled: "Stalled" };

/** Validation loss per round as an SVG line, from the held-out loss before round 0 to the latest round. */
function lossChart(run: LatestRun): string {
  const w = 560;
  const h = 190;
  const padL = 40;
  const padB = 24;
  const padT = 10;
  const points: { x: number; y: number }[] = [];
  if (run.initial_val_loss !== null) points.push({ x: 0, y: run.initial_val_loss });
  for (const r of run.log) points.push({ x: r.round + 1, y: r.val_loss });
  const maxX = Math.max(run.rounds, 1);
  const maxY = Math.max(...points.map((p) => p.y), 1);
  const px = (x: number) => padL + (x / maxX) * (w - padL - 8);
  const py = (y: number) => h - padB - (y / maxY) * (h - padB - padT);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`).join(" ");
  const last = points.at(-1);
  const yTicks = [0, 0.5, 1].map((f) => maxY * f);
  const grid = yTicks
    .map((v) => `<line x1="${padL}" x2="${w - 8}" y1="${py(v).toFixed(1)}" y2="${py(v).toFixed(1)}"/><text x="${padL - 6}" y="${(py(v) + 3).toFixed(1)}" text-anchor="end">${v.toFixed(1)}</text>`)
    .join("");
  const xTicks = [0, Math.round(maxX / 2), maxX]
    .map((v) => `<text x="${px(v).toFixed(1)}" y="${h - 6}" text-anchor="middle">${v}</text>`)
    .join("");
  const label = `Validation loss by round: ${points.length === 0 ? "no rounds yet" : `${loss(points[0]!.y)} before training, ${loss(last!.y)} after ${run.rounds_done} of ${run.rounds} rounds`}`;
  return `<figure class="vl"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><g class="vl-grid">${grid}${xTicks}</g>${
    points.length > 1 ? `<path class="vl-area" d="${line} L${px(last!.x).toFixed(1)} ${h - padB} L${px(points[0]!.x).toFixed(1)} ${h - padB} Z"/><path class="vl-line" d="${line}"/>` : ""
  }${last ? `<circle class="vl-dot" cx="${px(last.x).toFixed(1)}" cy="${py(last.y).toFixed(1)}" r="3.5"/>` : ""}</svg><figcaption>Held-out loss, nats per character, against round</figcaption></figure>`;
}

function participantList(run: LatestRun, now: number): string {
  if (run.participants.length === 0) return "";
  const items = run.participants
    .map(
      (n) =>
        `<li><i class="${n.online ? "pn-on" : "pn-off"}" aria-hidden="true"></i><span><b>${esc(n.gpu)}</b><small>${esc(n.hostname)} · ${esc(deviceName(n.device))}${n.github ? ` · @${esc(n.github)}` : ""}</small></span><em>${n.online ? "online" : `seen ${ago(n.last_heartbeat, now)}`}</em></li>`,
    )
    .join("");
  return `<ul class="run-nodes" aria-label="Participants">${items}</ul>`;
}

/** Inner HTML of the "latest run" card. */
export function runCard(s: Summary): string {
  const run = s.latest_run;
  if (!run) return "";
  const pct = run.rounds === 0 ? 0 : Math.round((run.rounds_done / run.rounds) * 100);
  const live = run.state === "training";
  const agree = run.rounds_done === 0 ? "No rounds yet" : run.hashes_agree_all ? `Weights hashes agree in all ${run.rounds_done} rounds` : "Weights hashes DIFFER in at least one round";
  const last = run.log.at(-1);
  return `<header><h2 id="run-h">Latest training run</h2><span class="dchip${live ? "" : " dchip-quiet"}"><i aria-hidden="true"></i>${esc(STATE_LABEL[run.state] ?? run.state)}</span><a class="dlink" href="${PROOF_OF_CONCEPT_URL}" rel="noopener">About <svg aria-hidden="true"><use href="#i-arr"/></svg></a></header>
<div class="run-info run-wide">
<h3>${esc(run.id)}</h3>
<p>${esc(run.model)} · ${count(run.params)} parameters · swarm proof of concept over Tailscale</p>
<p class="run-prog"><progress max="100" value="${pct}" aria-label="Rounds completed">${pct}%</progress><b>${run.rounds_done}/${run.rounds}</b></p>
<p class="run-state"><b>${loss(last?.val_loss ?? run.initial_val_loss)}</b>${last ? `validation loss now, ${loss(run.initial_val_loss)} before round 0` : "validation loss before round 0"}</p>
${lossChart(run)}
${participantList(run, s.generated_at)}
<p class="run-hash"><span>${esc(agree)}</span> Weights <code title="${esc(run.weights_hash ?? "")}">${esc(short(run.weights_hash))}</code>${run.git_sha ? ` · git <code>${esc(run.git_sha.slice(0, 7))}</code>` : ""}${run.wall_seconds === null ? "" : ` · ${duration(run.wall_seconds)} wall`}</p>
</div>`;
}

/** Inner HTML of the "devices by type" card. */
export function devicesCard(s: Summary): string {
  const total = s.totals.nodes_registered;
  const rows = s.devices
    .map((d, i) => `<li><i class="sw sw-${Math.min(i + 1, 4)}" aria-hidden="true"></i>${esc(deviceName(d.device))}<b>${d.registered}<small> · ${d.online} online</small></b></li>`)
    .join("");
  return `<header><h2 id="util-h">Devices by type</h2><span class="dchip dchip-quiet">${s.totals.nodes_online} online</span></header>
<div class="util-body">
<div class="donut" role="img" aria-label="${total} registered ${total === 1 ? "node" : "nodes"}, ${s.totals.nodes_online} online"><b>${total}</b><span>${total === 1 ? "node" : "nodes"} registered</span></div>
<ul class="util-legend">${rows || '<li class="util-none">No node has joined yet</li>'}</ul>
<p class="util-note">Each node is one machine running <code>${JOIN_COMMAND}</code>. Online means a heartbeat in the last ${s.online_window_seconds / 60} minutes.</p>
</div>`;
}

/** The network-compute card (replaces the guest "your contribution" placeholder). */
export function computeCard(s: Summary): string {
  return `<header><h2 id="mine-h">Network compute</h2><a class="dlink" href="/join">Sign up <svg aria-hidden="true"><use href="#i-arr"/></svg></a></header>
<p class="mine-val"><b>${duration(s.totals.compute_seconds)}</b> node time</p>
<p class="mine-note">Inner-loop training time summed over every node and round reported by a coordinator. Sign in to see your own nodes and the runs they joined.</p>`;
}

/** The three figures beside the world map. The PoC does not collect locations, so there are no regions. */
export function mapStats(s: Summary): string {
  const item = (icon: string, value: number, label: string) => `<li><svg aria-hidden="true"><use href="#${icon}"/></svg><div><b>${count(value)}</b><span>${label}</span></div></li>`;
  return [item("i-mesh", s.totals.nodes_online, "Nodes online"), item("i-gpu", s.totals.nodes_registered, "Nodes registered"), item("i-train", s.totals.rounds, "Rounds trained")].join("");
}

export const mapNote = (s: Summary) =>
  s.totals.nodes_registered === 0
    ? "No node has joined yet. The first lights appear when a node does."
    : "Locations are not collected yet, so nodes are not placed on the map.";

// ---- /console ----------------------------------------------------------------------------------

const statusBadge = (online: boolean) => `<span class="ws-badge ws-${online ? "live" : "idle"}">${online ? "Online" : "Offline"}</span>`;

export function nodeTable(nodes: SwarmNode[], now: number): string {
  if (nodes.length === 0) return "";
  const rows = nodes
    .map(
      (n) =>
        `<tr><th scope="row"><b>${esc(n.hostname)}</b><small>${esc(n.gpu)}</small></th><td>${statusBadge(n.online)}<small>${n.online ? "heartbeat" : "last seen"} ${ago(n.last_heartbeat, now)}</small></td><td>${esc(deviceName(n.device))}<small>${n.memory_gib} GiB · torch ${esc(n.torch)}</small></td><td>${n.rounds}<small>${duration(n.compute_seconds)}</small></td><td>${when(n.first_seen)}</td></tr>`,
    )
    .join("");
  return `<div class="ws-table-wrap"><table class="ws-table"><thead><tr><th scope="col">Node</th><th scope="col">Status</th><th scope="col">Device</th><th scope="col">Rounds · compute</th><th scope="col">First seen</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

type MemberRun = MemberSwarm["runs"][number];

const runState = (r: RunRow, nodes: SwarmNode[]) => (r.status === "training" && !nodes.some((n) => n.online) ? "stalled" : r.status);

export function memberRunTable(runs: MemberRun[], mine: SwarmNode[]): string {
  if (runs.length === 0) return "";
  const rows = runs
    .map((r) => {
      const state = runState(r, mine);
      const tone = state === "done" ? "live" : state === "training" ? "warn" : "idle";
      return `<tr><th scope="row"><b>${esc(r.id)}</b><small>${esc(r.model)} · ${count(r.params)} params</small></th><td><span class="ws-badge ws-${tone}">${esc(STATE_LABEL[state] ?? state)}</span></td><td>${r.rounds_done} / ${r.rounds}<small>${r.peers} ${r.peers === 1 ? "node" : "nodes"}</small></td><td>${loss(r.initial_val_loss)} to ${loss(r.final_val_loss)}</td><td>${r.my_rounds}<small>${duration(r.my_seconds)}</small></td><td><code title="${esc(r.weights_hash ?? "")}">${esc(short(r.weights_hash))}</code></td></tr>`;
    })
    .join("");
  return `<div class="ws-table-wrap"><table class="ws-table"><thead><tr><th scope="col">Run</th><th scope="col">Status</th><th scope="col">Rounds</th><th scope="col">Validation loss</th><th scope="col">Your rounds · compute</th><th scope="col">Weights</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export const nodeCommand = (login: string) => `${JOIN_COMMAND} --coordinator http://<coordinator>:8470 --github ${login}`;

export const totalSeconds = (m: MemberSwarm) => m.nodes.reduce((a, n) => a + n.compute_seconds, 0);
export const totalRounds = (m: MemberSwarm) => m.nodes.reduce((a, n) => a + n.rounds, 0);
export const onlineCount = (m: MemberSwarm) => m.nodes.filter((n) => n.online).length;

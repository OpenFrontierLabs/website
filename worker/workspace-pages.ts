// The workspace pages. Every number is either the person's own data (sign-up, answers, status
// history) or a real zero from a program that has not trained anything yet.
import { esc } from "./esc";
import { DATASETS, DATASETS_URL, JOIN_NODE_URL, LEDGER_NOTE, MODELS, RUN0_READINESS, RUN0_URL, RUNS, STAGE_LABEL, WEIGHTS_LICENCE, DOCS_URL } from "./program";
import { answersList, questionnaireForm } from "./member";
import { DISCORD_URL, pathsFor } from "./starter";
import { CONTRIBUTIONS, declaredDevices, deviceTotal, vendorMix, type Answers, type Device, type HardwareKind } from "./questionnaire";
import { duration, memberRunTable, nodeCommand, nodeTable, onlineCount, totalRounds, totalSeconds } from "./swarm-view";
import { ago, badge, dailyChart, donut, icon, kpis, more, panel, progress, workspacePage, type WorkspaceData } from "./workspace";

const NO_COMPUTE = "No compute recorded yet. Run ofl node join to add some.";
const minutes = (d: WorkspaceData) => d.swarm.daily_seconds.map((s) => Math.round(s / 6) / 10);

const primary = (href: string, label: string, id = "w-plus") =>
  `<a class="btn btn-primary btn-sm" href="${href}"${href.startsWith("http") ? ' rel="noopener"' : ""}>${icon(id, "size-4")}<span>${esc(label)}</span></a>`;
const secondary = (href: string, label: string) =>
  `<a class="btn btn-sm" href="${href}"${href.startsWith("http") ? ' rel="noopener"' : ""}><span>${esc(label)}</span>${icon(href.startsWith("http") ? "w-ext" : "w-arr", "size-4")}</a>`;

function standing(d: WorkspaceData): { value: string; note: string } {
  switch (d.user.status) {
    case "waitlisted":
      return { value: `#${d.position}`, note: `of ${d.waiting} on the waitlist` };
    case "invited":
      return { value: "Invited", note: "Your invite is open" };
    case "active":
      return { value: "Active", note: "Member of the network" };
    case "rejected":
      return { value: "Closed", note: "Sign-up not accepted" };
  }
}

function deviceRows(devices: Device[], a: Answers, selected?: HardwareKind): string {
  if (devices.length === 0) {
    return `<div class="ws-empty">${icon("w-chip")}<p><b>No hardware declared.</b> If you have a GPU, Apple M-series Mac or TPU access, add it in Settings so we can plan Run 0 capacity.</p>${more("/console/profile", "Add hardware")}</div>`;
  }
  return `<ul class="ws-devices">${devices
    .map(
      (dv) => `<li${dv.kind === selected ? ' class="ws-on"' : ""}><a href="/console/nodes?device=${dv.kind}"${dv.kind === selected ? ' aria-current="true"' : ""}><span class="ws-dev-ico">${icon("w-chip")}</span><span><b>${esc(dv.label)}</b><small>${dv.count} ${dv.count === 1 ? "device" : "devices"} · declared at sign-up</small></span>${badge("Declared", "idle")}</a></li>`,
    )
    .join("")}</ul>${a.gpuDetails ? `<p class="ws-note">Your hardware note: ${esc(a.gpuDetails)}</p>` : ""}`;
}

function activity(d: WorkspaceData): string {
  const items = [
    ...d.events.map((e) => ({
      at: e.at,
      title: `Status changed to ${e.to_status ?? "unknown"}`,
      note: e.from_status ? `From ${e.from_status}, by an operator` : "By an operator",
      ico: "w-check",
    })),
    { at: d.user.created_at, title: "Joined the waitlist", note: "Signed up with GitHub", ico: "w-check" },
  ];
  const next =
    d.user.status === "rejected"
      ? ""
      : `<li class="ws-next"><span class="ws-act-ico">${icon("w-wait")}</span><span><b>Next: Run 0 opens</b><small>Invites go out in sign-up order</small></span><time>Planned</time></li>`;
  return `<ol class="ws-activity">${next}${items
    .map((i) => `<li><span class="ws-act-ico">${icon(i.ico)}</span><span><b>${esc(i.title)}</b><small>${esc(i.note)}</small></span><time datetime="${esc(i.at)}">${ago(i.at, d.now)}</time></li>`)
    .join("")}</ol>`;
}

const run0 = RUNS[0]!;

const ASSIGNMENT: Record<WorkspaceData["user"]["status"], string> = {
  waitlisted: "Opens with your invite",
  invited: "Waits for the first GPU run",
  active: "None yet",
  rejected: "None",
};

function assignment(d: WorkspaceData): string {
  const rows: [string, string][] = [
    ["Your assignment", ASSIGNMENT[d.user.status]],
    ["Peers in the run", "0"],
    ["Verification", "Signed updates, planned"],
  ];
  return panel(
    "Current assignment",
    badge(STAGE_LABEL[run0.stage], "warn"),
    `<p class="ws-kicker">Phase 1 · first run</p>
<h3 class="ws-title">${esc(run0.name)}</h3>
<p class="ws-sub">${esc(run0.summary)} · ${esc(run0.mode)}</p>
<div class="ws-row"><span>Run progress</span>${progress(0, "Run 0 progress")}</div>
<dl class="ws-dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
<a class="ws-wide-btn" href="${RUN0_URL}" rel="noopener">Open run details${icon("w-ext")}</a>`,
  );
}

/** `thanks` is set on the page shown right after the questionnaire is first submitted. */
export function overview(d: WorkspaceData, thanks = false): string {
  const devices = declaredDevices(d.answers);
  const s = standing(d);
  return workspacePage(
    d,
    "/console",
    {
      eyebrow: "Personal workspace",
      title: "Overview",
      lede: "Your compute, training assignments and published evidence, live. Your nodes and their rounds come from the swarm proof of concept; Run 0 has not started.",
      actions: `${secondary(DISCORD_URL, "Join the Discord")}${primary(RUN0_URL, "Try Run 0 yourself", "w-play")}`,
    },
    `${thanks ? '<p class="app-ok" role="status">Thank you for joining. Your answers are saved.</p>' : ""}${kpis([
      { label: "Node compute", value: duration(totalSeconds(d.swarm)), note: "Training time on your nodes", href: "/console/contributions" },
      { label: "Online nodes", value: String(onlineCount(d.swarm)), note: `${d.swarm.nodes.length} registered · ${deviceTotal(devices)} declared`, href: "/console/nodes" },
      { label: "Training runs", value: String(d.swarm.runs.length), note: "Your nodes took part in", href: "/console/runs" },
      { label: "Your place", value: s.value, note: s.note },
    ])}
<div class="ws-grid ws-grid-main">
${panel("Contribution over time", '<span class="ws-tag">Last 30 days</span>', `<p class="ws-big"><b>${duration(totalSeconds(d.swarm))}</b> node time <span>all time</span></p>${dailyChart(minutes(d), d.now, "Node minutes", NO_COMPUTE)}`)}
${assignment(d)}
</div>
<div class="ws-grid ws-grid-even">
${panel("Your compute nodes", more("/console/nodes", "Manage nodes"), d.swarm.nodes.length > 0 ? nodeTable(d.swarm.nodes, d.now.getTime()) : deviceRows(devices, d.answers))}
${panel("Recent activity", "", activity(d))}
</div>
${starterIssues(d.answers)}`,
  );
}

function starterIssues(a: Answers): string {
  const paths = pathsFor(a.contributions)
    .map((p) => `<li><a href="${esc(p.href)}" rel="noopener"><b>${esc(p.title)}</b><span>${esc(p.what)}</span><small>${esc(p.linkText)}${icon("w-ext")}</small></a></li>`)
    .join("");
  const matched = a.contributions.length > 0 ? "Matched to what you said you can contribute." : "You did not pick a contribution yet, so here is every path.";
  return panel(
    "Start here: starter issues for you",
    more(DISCORD_URL, "Ask in Discord"),
    `<p class="ws-lead">${matched} Each link is a live GitHub search of open good first issues; say hello in the Discord and ask for one to be assigned to you.</p><ul class="ws-paths">${paths}</ul>`,
  );
}

function swarmRuns(d: WorkspaceData): string {
  return (
    memberRunTable(d.swarm.runs, d.swarm.nodes) ||
    `<div class="ws-empty">${icon("w-play")}<p><b>No run yet.</b> Runs your nodes join appear here with rounds, validation loss and compute time. Start one with <code>${esc(nodeCommand(d.v.login))}</code>.</p></div>`
  );
}

export function nodes(d: WorkspaceData, selectedKind: string | null): string {
  const devices = declaredDevices(d.answers);
  const sel = devices.find((x) => x.kind === selectedKind) ?? devices[0];
  const hours = d.answers.hoursPerWeek;
  const detail = sel
    ? panel(
        sel.label,
        badge("Declared", "idle"),
        `<p class="ws-kicker">Selected device · declared at sign-up</p>
<h3 class="ws-title">${sel.count} × ${esc(sel.label)}</h3>
<p class="ws-sub">Declared at sign-up. Machines you have joined are listed in the inventory.</p>
<div class="ws-pair"><div><p class="ws-kicker">Offered time</p><b>${hours === null ? "Not given" : `${hours} h / week`}</b></div></div>
<h4 class="ws-h4">Participation policy</h4>
<dl class="ws-dl"><dt>Your hardware note</dt><dd>${d.answers.gpuDetails ? esc(d.answers.gpuDetails) : "Not given"}</dd><dt>Maximum compute load</dt><dd>Set in the Node app (planned)</dd><dt>Schedule</dt><dd>${hours === null ? "Not set" : `Up to ${hours} h a week`}</dd><dt>Checkpoint recovery</dt><dd>Planned with phase 3</dd></dl>
<a class="ws-wide-btn" href="/console/profile">Edit declared hardware${icon("w-arr")}</a>`,
        "ws-detail",
      )
    : panel("No device selected", "", `<div class="ws-empty">${icon("w-server")}<p>Declare your hardware in Settings and it appears here, ready to connect with ofl node join.</p>${more("/console/profile", "Open Settings")}</div>`, "ws-detail");
  return workspacePage(
    d,
    "/console/nodes",
    {
      eyebrow: "Contributor infrastructure",
      title: "Compute nodes",
      lede: "The hardware you offered, and its schedule. Machines join today with ofl node join, as a proof of concept over Tailscale; the Node app is planned.",
      actions: `${secondary(JOIN_NODE_URL, "Node guide")}${primary("/console/profile", "Add hardware")}`,
    },
    `${kpis([
      { label: "Registered nodes", value: String(d.swarm.nodes.length), note: d.swarm.nodes.length === 0 ? "Join with ofl node join" : `${onlineCount(d.swarm)} online now` },
      { label: "Declared devices", value: String(deviceTotal(devices)), note: devices.length ? devices.map((x) => x.label.split(" ")[0]).join(" · ") : "None declared" },
      { label: "Online now", value: `${onlineCount(d.swarm)} of ${d.swarm.nodes.length}`, note: "Heartbeat in the last 2 minutes" },
      { label: "Node compute", value: duration(totalSeconds(d.swarm)), note: `${totalRounds(d.swarm)} rounds trained` },
    ])}
<div class="ws-grid ws-grid-even">
${panel(
  "Node inventory",
  `<span class="ws-tag">${d.swarm.nodes.length} registered · ${devices.length} declared</span>`,
  `${d.swarm.nodes.length > 0 ? nodeTable(d.swarm.nodes, d.now.getTime()) : `<div class="ws-empty">${icon("w-server")}<p><b>No node registered to @${esc(d.v.login)}.</b> Start a node with <code>${esc(nodeCommand(d.v.login))}</code>; it appears here within seconds.</p></div>`}
<h4 class="ws-h4">Declared at sign-up</h4>
${deviceRows(devices, d.answers, sel?.kind)}
<div class="ws-callout"><b>Join a node today</b><p>Nodes join with <code>ofl node join</code> against a coordinator, as a proof of concept over Tailscale; the Node app is planned. <code>make doctor</code> in the openfrontier repository checks a machine first: GPU, CUDA, disk and network, no GPU required.</p>${secondary(JOIN_NODE_URL, "Joining a node")}</div>`,
)}
${detail}
</div>`,
  );
}

export function runs(d: WorkspaceData): string {
  const stageTone = (s: string) => (s === "scaffolding" ? "warn" : "plan");
  const readiness = RUN0_READINESS.map(
    ([label, ok]) => `<li class="${ok ? "ws-ok" : "ws-todo"}">${icon(ok ? "w-check" : "w-wait")}<span>${esc(label)}</span><b>${ok ? "Done" : "Not yet"}</b></li>`,
  ).join("");
  const done = RUN0_READINESS.filter(([, ok]) => ok).length;
  const phases = RUNS.map(
    (r, i) => `<li><a class="ws-phase${i === 0 ? " ws-phase-now" : ""}" href="${r.docs}" rel="noopener"><span class="ws-phase-dot" aria-hidden="true"></span><b>${esc(r.name)}</b><small>${esc(r.mode)}</small>${badge(STAGE_LABEL[r.stage], stageTone(r.stage))}</a></li>`,
  ).join("");
  const table = `<div class="ws-table-wrap"><table class="ws-table">
<thead><tr><th scope="col">Model / run</th><th scope="col">Status</th><th scope="col">Mode</th><th scope="col">Progress</th><th scope="col">Peers</th><th scope="col"><span class="sr-only">Details</span></th></tr></thead>
<tbody>${RUNS.map(
    (r) => `<tr><th scope="row"><b>${esc(r.name)}</b><small>${esc(r.summary)}</small></th><td>${badge(STAGE_LABEL[r.stage], stageTone(r.stage))}</td><td>${esc(r.mode)}</td><td>${progress(0, `${r.name} progress`)}</td><td>0</td><td><a class="ws-more" href="${r.docs}" rel="noopener">View${icon("w-ext")}</a></td></tr>`,
  ).join("")}</tbody></table></div>`;
  return workspacePage(
    d,
    "/console/runs",
    {
      eyebrow: "Distributed training",
      title: "Training runs",
      lede: "Every planned run, in phase order, with what exists today. Run 0 is the first full-size run and is scaffolded; the swarm proof of concept below has trained a small model on real nodes.",
      actions: `${secondary(DOCS_URL, "Training docs")}${primary(RUN0_URL, "Try Run 0 yourself", "w-play")}`,
    },
    `${kpis([
      { label: "Active assignments", value: String(d.swarm.runs.filter((r) => r.status === "training").length), note: "Your nodes training now" },
      { label: "Runs joined", value: String(d.swarm.runs.length), note: "Swarm proof of concept" },
      { label: "Updates pushed", value: String(totalRounds(d.swarm)), note: "Rounds from your nodes" },
      { label: "Peers in latest run", value: String(d.swarm.runs[0]?.peers ?? 0), note: "Nodes, yours included" },
    ])}
${panel("Swarm runs you joined", '<span class="ws-tag">Proof of concept</span>', swarmRuns(d))}
<div class="ws-grid ws-grid-main">
${panel("Program", '<span class="ws-tag">Phase order</span>', `<ol class="ws-phases">${phases}</ol><p class="ws-note">Single-node runs come first. The swarm proof of concept (DiLoCo over Tailscale, a small model) runs today; the real phase 3 is not built.</p>`)}
${panel("Run 0 readiness", badge(`${done} of ${RUN0_READINESS.length}`, "warn"), `<ul class="ws-checks">${readiness}</ul><a class="ws-wide-btn" href="${RUN0_URL}" rel="noopener">Read the Run 0 plan${icon("w-ext")}</a>`)}
</div>
${panel("Explore training runs", '<span class="ws-tag">All phases</span>', table)}`,
  );
}

export function models(d: WorkspaceData, tab: string | null): string {
  const datasets = tab === "datasets";
  const tabs = `<nav class="ws-tabs" aria-label="Artifact type"><a href="/console/models"${datasets ? "" : ' aria-current="page"'}>Models</a><a href="/console/models?tab=datasets"${datasets ? ' aria-current="page"' : ""}>Datasets</a></nav>`;
  const modelTable = `<div class="ws-table-wrap"><table class="ws-table">
<thead><tr><th scope="col">Model</th><th scope="col">Parameters</th><th scope="col">State</th><th scope="col">Weights licence</th><th scope="col"><span class="sr-only">Details</span></th></tr></thead>
<tbody>${MODELS.map((m) => {
    const run = RUNS.find((r) => r.id === m.run)!;
    return `<tr><th scope="row"><b>${esc(m.name)}</b><small>${esc(m.family)}</small></th><td>${esc(m.params)}</td><td>${badge("Not trained", "plan")}</td><td>${esc(WEIGHTS_LICENCE)} (planned)</td><td><a class="ws-more" href="${run.docs}" rel="noopener">Explore${icon("w-ext")}</a></td></tr>`;
  }).join("")}</tbody></table></div><p class="ws-note">${MODELS.length} planned models, 0 released.</p>`;
  const dataTable = `<div class="ws-table-wrap"><table class="ws-table">
<thead><tr><th scope="col">Dataset</th><th scope="col">Licence</th><th scope="col">Used by</th><th scope="col">Revision</th></tr></thead>
<tbody>${DATASETS.map(
    (x) => `<tr><th scope="row"><a href="https://huggingface.co/datasets/${esc(x.id)}" rel="noopener"><b>${esc(x.id)}</b></a></th><td>${esc(x.licence)}</td><td>${esc(x.usedBy)}</td><td><code>${esc(x.revision)}</code></td></tr>`,
  ).join("")}</tbody></table></div><p class="ws-note">Revisions are Hugging Face commits. No content hashes are recorded because none have been computed. ${more(DATASETS_URL, "Data manifest")}</p>`;
  return workspacePage(
    d,
    "/console/models",
    {
      eyebrow: "Shared public artifacts",
      title: "Model registry",
      lede: "Open models, checkpoints and the data behind them. Nothing is released yet; the registry fills from Run 0, with every checkpoint public.",
      actions: `${secondary(DATASETS_URL, "Data manifest")}${primary(RUN0_URL, "How Run 0 trains", "w-play")}`,
    },
    `${kpis([
      { label: "Released models", value: "0", note: `${MODELS.length} planned` },
      { label: "Checkpoints", value: "0", note: "Public from the first run" },
      { label: "Dataset manifests", value: String(DATASETS.length), note: "Pinned revisions", href: "/console/models?tab=datasets" },
      { label: "Signed manifests", value: "0", note: "No content hashes yet" },
    ])}
${panel("Artifact discovery", more("https://github.com/OpenFrontierLabs/openfrontier", "Repository"), `${tabs}${datasets ? dataTable : modelTable}`)}
<section class="ws-feature" aria-labelledby="p-feature"><div><p class="ws-kicker">First open release</p><h2 id="p-feature">${esc(run0.name)}</h2><p>Weights, config, logs and every checkpoint, under ${esc(WEIGHTS_LICENCE)} with no use restrictions, when Run 0 finishes.</p></div><div class="ws-feature-tags">${badge("Open weights · planned", "plan")}${badge("Signed manifest · planned", "plan")}${secondary(RUN0_URL, "Read the plan")}</div></section>`,
  );
}

export function contributions(d: WorkspaceData): string {
  const devices = declaredDevices(d.answers);
  const offered = d.answers.contributions.map((c) => CONTRIBUTIONS[c]);
  return workspacePage(
    d,
    "/console/contributions",
    {
      eyebrow: "Public contribution record",
      title: "Contributions",
      lede: "Compute time from your nodes, the runs they joined and what you offered. Signed receipts and the public ledger by GitHub handle are planned.",
      actions: `${secondary(`https://github.com/${encodeURIComponent(d.v.login)}`, "Your GitHub")}${primary("/console/profile", "Edit what you offer", "w-gear")}`,
    },
    `${kpis([
      { label: "Compute contributed", value: duration(totalSeconds(d.swarm)), note: "Training time on your nodes" },
      { label: "Updates pushed", value: String(totalRounds(d.swarm)), note: `Across ${d.swarm.runs.length} ${d.swarm.runs.length === 1 ? "run" : "runs"}` },
      { label: "Signed receipts", value: "0", note: "Shareable evidence" },
      { label: "You offered", value: String(offered.length), note: offered.length ? offered.slice(0, 3).join(" · ") : "Nothing chosen yet", href: "/console/profile" },
    ])}
<div class="ws-grid ws-grid-main">
${panel("Compute contribution history", '<span class="ws-tag">Last 30 days</span>', `<p class="ws-big"><b>${duration(totalSeconds(d.swarm))}</b> node time</p>${dailyChart(minutes(d), d.now, "Node minutes", NO_COMPUTE)}`)}
${panel(
  "Declared hardware",
  '<span class="ws-tag">At sign-up</span>',
  `${donut(vendorMix(devices), `<b>${deviceTotal(devices)}</b><small>devices</small>`, devices.length ? "Share of the devices you declared, by vendor" : "No devices declared")}
<dl class="ws-dl"><dt>Public record</dt><dd>From Run 0</dd><dt>Evidence</dt><dd>Signed receipts, planned</dd></dl>`,
)}
</div>
${panel("Runs you contributed to", '<span class="ws-tag">Swarm proof of concept</span>', swarmRuns(d))}
${panel(
  "Signed compute receipts",
  '<span class="ws-tag">0 receipts</span>',
  `<div class="ws-table-wrap"><table class="ws-table"><thead><tr><th scope="col">Receipt</th><th scope="col">Training run</th><th scope="col">Contributor node</th><th scope="col">Compute</th><th scope="col">Evidence</th></tr></thead>
</table></div>
<div class="ws-empty">${icon("w-ledger")}<p><b>No receipts yet.</b> ${esc(LEDGER_NOTE)} Each accepted update will carry a signed receipt you can share.</p></div>`,
)}`,
  );
}


export function settings(d: WorkspaceData, form: Answers, errors: Record<string, string>, saved: boolean): string {
  return workspacePage(
    d,
    "/console/profile",
    {
      eyebrow: "Your account",
      title: "Settings",
      lede: "What you told us when you signed up. Change anything here; only your name is required.",
      actions: secondary(`https://github.com/${encodeURIComponent(d.v.login)}`, "Your GitHub"),
    },
    `${saved ? '<p class="app-ok" role="status">Saved.</p>' : ""}<div class="ws-grid ws-grid-settings">
${panel("Edit your answers", "", questionnaireForm(form, errors, "/console/profile", "Save"))}
${panel("Saved answers", "", answersList(d.answers))}
</div>`,
  );
}

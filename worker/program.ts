// The training program as OpenFrontierLabs/openfrontier documents it (docs/, manifests/datasets.toml).
// Update these with the docs: they are the only non-database facts the workspace shows.
const REPO = "https://github.com/OpenFrontierLabs/openfrontier";
export const DOCS_URL = `${REPO}/tree/main/docs`;
export const RUN0_URL = `${REPO}/blob/main/docs/run0.md`;
export const JOIN_NODE_URL = `${REPO}/blob/main/docs/join-a-node.md`;
export const LEDGER_NOTE = "Compute is credited by GitHub handle in the public compute ledger from Run 0 on.";

export type Stage = "scaffolding" | "documented" | "configured";
export const STAGE_LABEL: Record<Stage, string> = { scaffolding: "Scaffolding", documented: "Not built", configured: "Not built" };

export interface Run {
  id: string;
  name: string;
  summary: string;
  mode: string;
  stage: Stage;
  docs: string;
}

/** Phase order. Nothing has been trained: every run is at 0% with 0 peers. */
export const RUNS: Run[] = [
  { id: "run-0", name: "OFL Run 0", summary: "Dense decoder, 1.485B parameters (OLMo-core)", mode: "One GPU node", stage: "scaffolding", docs: RUN0_URL },
  { id: "phase-1-moe", name: "Phase 1 MoE", summary: "64 experts, top-8: 6.86B total, 1.22B active", mode: "One 8-GPU node", stage: "scaffolding", docs: `${REPO}/blob/main/docs/phase1-moe.md` },
  { id: "phase-2-post", name: "Phase 2 post-training", summary: "SFT, DPO, RLVR (open-instruct, prime-rl)", mode: "Post-training", stage: "documented", docs: `${REPO}/blob/main/docs/phase2-post.md` },
  { id: "phase-3-diloco", name: "Phase 3 DiLoCo", summary: "Outer loops across islands (prime-diloco)", mode: "DiLoCo islands", stage: "configured", docs: `${REPO}/blob/main/docs/phase3-diloco.md` },
];

/** What run0.md says exists today, each checked against the pinned upstream. */
export const RUN0_READINESS: [string, boolean][] = [
  ["Launcher and config", true],
  ["Upstreams pinned and verified", true],
  ["CPU smoke run", true],
  ["First GPU run", false],
  ["Checkpoints and weights published", false],
];

export interface Model {
  name: string;
  family: string;
  params: string;
  run: string;
}

export const MODELS: Model[] = [
  { name: "OFL Run 0", family: "Dense base model", params: "1.485B", run: "run-0" },
  { name: "OFL MoE", family: "Mixture-of-experts base model", params: "6.86B / 1.22B active", run: "phase-1-moe" },
];
/** datasets.toml: "Open Frontier Labs releases weights under Apache-2.0 with no use restrictions". */
export const WEIGHTS_LICENCE = "Apache-2.0";

export interface Dataset {
  id: string;
  licence: string;
  usedBy: string;
  revision: string;
}

export const DATASETS: Dataset[] = [
  { id: "HuggingFaceFW/fineweb-edu", licence: "ODC-By 1.0", usedBy: "Phase 1 dense and MoE", revision: "87f0914" },
  { id: "allenai/dolma3_mix-6T-1025-7B", licence: "ODC-By 1.0", usedBy: "Run 0 (reference mix)", revision: "2ca900f" },
  { id: "allenai/dolma3_dolmino_mix-100B-1125", licence: "ODC-By 1.0", usedBy: "Dense, later stage", revision: "f23aa12" },
  { id: "allenai/dolma3_longmino_mix-100B-1125", licence: "ODC-By 1.0", usedBy: "Dense, long context", revision: "28fea43" },
  { id: "PrimeIntellect/fineweb-edu", licence: "ODC-By 1.0", usedBy: "Phase 3 DiLoCo", revision: "14efaa2" },
];
export const DATASETS_URL = `${REPO}/blob/main/manifests/datasets.toml`;

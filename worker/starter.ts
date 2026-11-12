// Contributor paths and their starter issues, matched to the questionnaire's "What you can contribute" answers.
// Links are live GitHub searches (good first issue plus the path's label), never hard-coded issue numbers.
import type { Contribution } from "./questionnaire";

export const DISCORD_URL = "https://discord.gg/M4sD8T5M8D";
const REPO = "https://github.com/OpenFrontierLabs/openfrontier";

export const issueSearch = (label: string) =>
  `${REPO}/issues?q=${encodeURIComponent(`is:issue is:open label:"good first issue" label:"${label}"`)}`;

export interface ContributorPath {
  title: string;
  what: string;
  href: string;
  linkText: string;
}

const starter = (title: string, what: string, label: string): ContributorPath => ({ title, what, href: issueSearch(label), linkText: `Good first issues: ${label}` });

export const PATHS = {
  compute: starter("Compute donor", "Run a node or donate a cluster as an island.", "layer/2-node"),
  rust: starter("Rust and P2P", "The rust-libp2p peer, the node app, NAT traversal and signed messages.", "area/rust"),
  ml: starter("ML training", "DiLoCo, sharded training, stability and schedules.", "area/ml"),
  data: starter("Data", "Tokenised shards, manifests, licence and provenance checks.", "area/data"),
  evals: starter("Evals", "Task lists, harness configs and contamination checks.", "area/evals"),
  docs: starter("Docs and community", "Glossary, tutorials, translations, call notes and welcoming newcomers.", "area/docs"),
  web: starter("Web", "This website, the sign-up flow and the consoles.", "area/web"),
  funding: {
    title: "Funding",
    what: "Introductions to compute providers, grant writing and sponsorship.",
    href: `${REPO}/discussions`,
    linkText: "Start a thread in Discussions",
  },
} satisfies Record<string, ContributorPath>;

export type PathId = keyof typeof PATHS;

const BY_ANSWER: Record<Contribution, PathId[]> = {
  compute: ["compute"],
  code: ["rust", "web"],
  research: ["ml"],
  data: ["data"],
  evals: ["evals"],
  community: ["docs"],
  funding: ["funding"],
};

/** The paths matching the answers, in PATHS order; every path when nothing was picked. */
export function pathsFor(contributions: readonly Contribution[]): ContributorPath[] {
  const picked = new Set(contributions.flatMap((c) => BY_ANSWER[c]));
  return (Object.keys(PATHS) as PathId[]).filter((id) => picked.size === 0 || picked.has(id)).map((id) => PATHS[id]);
}

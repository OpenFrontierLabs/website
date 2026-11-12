// /join, the questionnaire form and the Member Console tabs.
import type { Status, UserRow } from "./db";
import { empty, esc, page, tabs, type Viewer } from "./html";
import { CONTRIBUTIONS, EXPERIENCE, HARDWARE, type Answers } from "./questionnaire";

export const MEMBER_TABS = [
  { href: "/console", label: "Overview" },
  { href: "/console/nodes", label: "My Nodes" },
  { href: "/console/contributions", label: "Contributions" },
  { href: "/console/runs", label: "Runs" },
  { href: "/console/teams", label: "Teams" },
  { href: "/console/profile", label: "Profile / Settings" },
];

const DISCORD_URL = "https://discord.gg/M4sD8T5M8D";

const discordIcon = (cls: string) =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.3 4.4a20 20 0 0 0-4.9-1.6l-.7 1.3a18 18 0 0 0-5.4 0L8.6 3a20 20 0 0 0-5 1.5q-4.4 7-3.5 13.7a20 20 0 0 0 6 3h.1q.8-1 1.2-2l-1.9-1V18l.4-.3c4 1.8 8.3 1.8 12.1 0h.1l.4.3v.1l-1.9 1q.5 1 1.2 2a20 20 0 0 0 6-3h.1q.7-7.7-3.5-13.7M8 15.4c-1.2 0-2.1-1.1-2.1-2.5s1-2.4 2.1-2.4 2.2 1 2.2 2.4-1 2.4-2.2 2.4m8 0c-1.2 0-2.2-1.1-2.2-2.5s1-2.4 2.2-2.4 2.2 1 2.1 2.4q-.1 2.3-2.1 2.4"/></svg>`;

export const PLANNED_MEMBER_TABS: Record<string, string> = {
  "/console/nodes": "Machines you connect through the Open Frontier Node app will show here.",
  "/console/contributions": "Compute, code, data and evals you contribute will be credited here by name.",
  "/console/runs": "Training runs you take part in will show here.",
  "/console/teams": "Teams you join or start will show here.",
};

export function joinPage(error: string | null, appOrigin: string, signInOpen = true): string {
  return page(
    "Join",
    null,
    `<section class="app-join gcard">
<p class="eyebrow">Join the network</p>
<h1>Join Open Frontier Labs.</h1>
<p>Sign in with GitHub to join the waitlist, then tell us what you can contribute. We read your public profile and your primary verified email; nothing else.</p>
${error ? `<p class="app-error" role="alert">${esc(error)}</p>` : ""}
${signInOpen ? `<a class="btn btn-primary" href="${appOrigin}/auth/github"><svg class="size-5" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg><span>Continue with GitHub</span></a>` : `<a class="btn" href="mailto:openfrontierlabs@gmail.com?subject=Donate%20compute%20to%20Open%20Frontier%20Labs">Email a compute offer instead</a>`}
<a class="btn" href="${DISCORD_URL}" rel="noopener">${discordIcon("size-5")}<span>Join the Discord</span></a>
<p>Not ready to sign up? The Discord is where contributors and compute providers talk first.</p>
</section>`,
    {
      description: "Sign up with GitHub to join the Open Frontier Labs waitlist and say what compute, code or time you can contribute. Nothing has been trained yet; Run 0 is forming.",
      canonical: `${appOrigin}/join`,
    },
  );
}

export const signedOutPage = () =>
  page("Signed out", null, `<section class="app-join gcard"><p class="eyebrow">Signed out</p><h1>You are signed out.</h1><a class="btn" href="/">Back to Open Frontier Labs</a></section>`);

export const forbiddenPage = (v: Viewer | null, appOrigin: string) =>
  page(
    "Operators only",
    v,
    `<section class="app-join gcard"><p class="eyebrow">Operator Console</p><h1>Operators only.</h1><p>The Operator Console is for admins of the OpenFrontierLabs GitHub organization.</p>${v ? '<a class="btn" href="/console">Go to your Member Console</a>' : `<a class="btn btn-primary" href="${appOrigin}/auth/github">Sign in with GitHub</a>`}</section>`,
  );

const field = (name: string, label: string, control: string, errors: Record<string, string>, hint = "") =>
  `<div class="field"><label for="${name}">${esc(label)}</label>${hint ? `<p class="hint">${esc(hint)}</p>` : ""}${control}${errors[name] ? `<p class="app-error" role="alert">${esc(errors[name])}</p>` : ""}</div>`;

const input = (name: string, value: string | number | null, attrs = "") =>
  `<input class="input" id="${name}" name="${name}" value="${esc(value ?? "")}" ${attrs}>`;

/** Blank answers prefilled from GitHub, for people who have not filled the form in yet. */
export const prefill = (u: UserRow): Answers => ({
  displayName: u.github_name || u.login,
  email: u.github_email,
  location: "",
  contributions: [],
  hardware: {},
  noHardware: false,
  gpuDetails: "",
  hoursPerWeek: null,
  experience: "",
  links: [],
  why: "",
  heardFrom: "",
  consent: false,
});

export function questionnaireForm(a: Answers, errors: Record<string, string>, action: string, submit: string): string {
  const contributions = Object.entries(CONTRIBUTIONS)
    .map(([k, label]) => `<label class="check"><input type="checkbox" name="contributions" value="${k}"${a.contributions.includes(k as never) ? " checked" : ""}> ${esc(label)}</label>`)
    .join("");
  const hardware = Object.entries(HARDWARE)
    .map(([k, label]) => `<label class="hw"><span>${esc(label)}</span><input class="input" type="number" min="0" max="100000" step="1" name="hw_${k}" value="${esc(a.hardware[k as keyof typeof HARDWARE] ?? "")}" placeholder="0" aria-label="${esc(label)} count"></label>`)
    .join("");
  const experience = [["", "Prefer not to say"], ...Object.entries(EXPERIENCE)]
    .map(([k, label]) => `<option value="${k}"${a.experience === k ? " selected" : ""}>${esc(label)}</option>`)
    .join("");
  return `<form class="app-form" method="post" action="${action}">
${field("displayName", "Display name", input("displayName", a.displayName, 'required maxlength="80" autocomplete="name"'), errors)}
${field("email", "Email", input("email", a.email, 'type="email" maxlength="254" autocomplete="email"'), errors, "Prefilled from your primary verified GitHub email.")}
${field("location", "Country / timezone", input("location", a.location, 'maxlength="80" placeholder="e.g. Japan, UTC+9"'), errors)}
<fieldset class="field"><legend>What you can contribute</legend><div class="checks">${contributions}</div>${errors.contributions ? `<p class="app-error">${esc(errors.contributions)}</p>` : ""}</fieldset>
<fieldset class="field"><legend>Hardware (how many of each)</legend><div class="hws">${hardware}<label class="check"><input type="checkbox" name="hw_none"${a.noHardware ? " checked" : ""}> None</label></div>${errors.hardware ? `<p class="app-error">${esc(errors.hardware)}</p>` : ""}</fieldset>
${field("gpuDetails", "GPU details", `<textarea class="input" id="gpuDetails" name="gpuDetails" rows="2" maxlength="500" placeholder="Models, VRAM, interconnect, bandwidth">${esc(a.gpuDetails)}</textarea>`, errors)}
${field("hoursPerWeek", "Hours per week", input("hoursPerWeek", a.hoursPerWeek, 'type="number" min="0" max="168" step="1"'), errors)}
${field("experience", "Experience level", `<select class="input" id="experience" name="experience">${experience}</select>`, errors)}
${field("links", "Links", `<textarea class="input" id="links" name="links" rows="2" maxlength="1200" placeholder="https://your.site&#10;https://huggingface.co/you">${esc(a.links.join("\n"))}</textarea>`, errors, "Personal site or Hugging Face, one per line.")}
${field("why", "Why you want to join", `<textarea class="input" id="why" name="why" rows="4" maxlength="2000">${esc(a.why)}</textarea>`, errors)}
${field("heardFrom", "How you heard about us", input("heardFrom", a.heardFrom, 'maxlength="200"'), errors)}
<div class="field"><label class="check"><input type="checkbox" name="consent"${a.consent ? " checked" : ""}> You may contact me at this email about Open Frontier Labs.</label>${errors.consent ? `<p class="app-error">${esc(errors.consent)}</p>` : ""}</div>
<button class="btn btn-primary" type="submit">${esc(submit)}</button>
</form>`;
}

export const questionnairePage = (v: Viewer, a: Answers, errors: Record<string, string>) =>
  page(
    "Questionnaire",
    v,
    `<header class="app-head"><p class="eyebrow">You are signed in</p><h1>A few questions.</h1><p>All optional except your name. You can change them later in Profile / Settings.</p></header>
${questionnaireForm(a, errors, "/join/questionnaire", "Join the waitlist")}`,
  );

function memberShell(v: Viewer, current: string, body: string): string {
  return page(
    "Member Console",
    v,
    `<header class="app-head"><p class="eyebrow">Member Console</p><h1>Welcome, ${esc(v.login)}.</h1></header>
${tabs(MEMBER_TABS, current, "Member Console")}
${body}`,
  );
}

const STATUS_COPY: Record<Status, string> = {
  waitlisted: "You're on the waitlist",
  invited: "You're invited",
  active: "You're an active member",
  rejected: "Your sign-up was not accepted",
};

export function overviewPage(v: Viewer, u: UserRow, position: number): string {
  const status = u.status === "waitlisted" ? `${STATUS_COPY.waitlisted}, #${position}` : STATUS_COPY[u.status];
  return memberShell(
    v,
    "/console",
    `<section class="gcard app-status"><p class="eyebrow">Status</p><h2>${esc(status)}.</h2><p>Signed up ${esc(u.created_at.slice(0, 10))}. We will email you when the first run opens, if you agreed to be contacted.</p><a class="more" href="/console/profile">Your answers and edit form</a></section>
<section class="gcard"><p class="eyebrow">Community</p><h2 class="app-h2">Join the Discord.</h2><p>Talk to the other contributors, compute providers and researchers in the open Discord server.</p><a class="btn" href="${DISCORD_URL}" rel="noopener">${discordIcon("size-5")}<span>Join the Discord</span></a></section>`,
  );
}

export function answersList(a: Answers): string {
  const hw = Object.entries(a.hardware).map(([k, n]) => `${HARDWARE[k as keyof typeof HARDWARE]}: ${n}`);
  const rows: [string, string][] = [
    ["Display name", a.displayName],
    ["Email", a.email],
    ["Country / timezone", a.location],
    ["Contributes", a.contributions.map((c) => CONTRIBUTIONS[c]).join(", ")],
    ["Hardware", a.noHardware ? "None" : hw.join(", ")],
    ["GPU details", a.gpuDetails],
    ["Hours per week", a.hoursPerWeek === null ? "" : String(a.hoursPerWeek)],
    ["Experience", a.experience ? EXPERIENCE[a.experience] : ""],
    ["Links", a.links.join(" ")],
    ["Why", a.why],
    ["Heard about us", a.heardFrom],
    ["May contact", a.consent ? "Yes" : "No"],
  ];
  return `<dl class="answers">${rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${val ? esc(val) : '<span class="muted">Not given</span>'}</dd>`).join("")}</dl>`;
}

export const profilePage = (v: Viewer, a: Answers, errors: Record<string, string>, saved: boolean) =>
  memberShell(
    v,
    "/console/profile",
    `${saved ? '<p class="app-ok" role="status">Saved.</p>' : ""}<section class="gcard"><h2 class="app-h2">Your answers</h2>${answersList(a)}</section>
<section class="gcard"><h2 class="app-h2">Edit</h2>${questionnaireForm(a, errors, "/console/profile", "Save")}</section>`,
  );

export const plannedMemberPage = (v: Viewer, current: string) =>
  memberShell(v, current, empty("Coming with the Node app", PLANNED_MEMBER_TABS[current] ?? ""));

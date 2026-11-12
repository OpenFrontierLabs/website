// Questionnaire options and the validator every save goes through.
export const CONTRIBUTIONS = {
  compute: "Compute",
  code: "Code",
  data: "Data",
  evals: "Evals",
  research: "Research",
  community: "Docs / community",
  funding: "Funding / sponsorship",
} as const;

export const HARDWARE = {
  nvidia_consumer: "NVIDIA consumer",
  nvidia_datacenter: "NVIDIA datacenter",
  amd: "AMD",
  apple: "Apple M-series (incl. M5/M6)",
  tpu: "Google TPU access",
} as const;

export const EXPERIENCE = {
  learning: "Learning",
  hobbyist: "Hobbyist",
  engineer: "Professional engineer",
  ml_engineer: "ML engineer",
  researcher: "Researcher",
} as const;

export type Contribution = keyof typeof CONTRIBUTIONS;
export type HardwareKind = keyof typeof HARDWARE;

export interface Answers {
  displayName: string;
  email: string;
  location: string;
  contributions: Contribution[];
  hardware: Partial<Record<HardwareKind, number>>;
  noHardware: boolean;
  gpuDetails: string;
  hoursPerWeek: number | null;
  experience: keyof typeof EXPERIENCE | "";
  links: string[];
  why: string;
  heardFrom: string;
  consent: boolean;
}

export interface FormLike {
  get(name: string): unknown;
  getAll(name: string): unknown[];
}

/** `errors` is empty when the answers are valid; `answers` always echoes the cleaned input for re-rendering. */
export interface Validation {
  answers: Answers;
  errors: Record<string, string>;
}

const MAX_COUNT = 100_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateAnswers(form: FormLike): Validation {
  const errors: Record<string, string> = {};
  const text = (name: string, max: number) => {
    const raw = form.get(name);
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value.length > max) errors[name] = `Keep this under ${max} characters.`;
    return value;
  };

  const displayName = text("displayName", 80);
  if (!displayName) errors.displayName = "Tell us what to call you.";
  const email = text("email", 254);
  if (email && !EMAIL.test(email)) errors.email = "That email address does not look right.";

  const contributions: Contribution[] = [];
  for (const v of form.getAll("contributions")) {
    if (typeof v !== "string" || !Object.hasOwn(CONTRIBUTIONS, v)) errors.contributions = "Pick from the listed options.";
    else if (!contributions.includes(v as Contribution)) contributions.push(v as Contribution);
  }

  const hardware: Partial<Record<HardwareKind, number>> = {};
  for (const kind of Object.keys(HARDWARE) as HardwareKind[]) {
    const raw = text(`hw_${kind}`, 6);
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > MAX_COUNT) errors.hardware = `Counts are whole numbers from 0 to ${MAX_COUNT}.`;
    else if (n > 0) hardware[kind] = n;
  }
  const noHardware = form.get("hw_none") === "on";
  if (noHardware && Object.keys(hardware).length > 0) errors.hardware = "You picked None and also gave hardware counts.";

  const hoursRaw = text("hoursPerWeek", 3);
  const hours = hoursRaw ? Number(hoursRaw) : null;
  if (hours !== null && (!Number.isInteger(hours) || hours < 0 || hours > 168)) {
    errors.hoursPerWeek = "Hours per week is a whole number from 0 to 168.";
  }

  const experience = text("experience", 20);
  if (experience && !Object.hasOwn(EXPERIENCE, experience)) errors.experience = "Pick from the listed options.";

  const links = text("links", 1200).split(/\s+/).filter(Boolean);
  if (links.length > 5) errors.links = "Up to 5 links.";
  for (const link of links) {
    let url: URL | null = null;
    try {
      url = new URL(link);
    } catch {
      url = null;
    }
    if (!url || (url.protocol !== "https:" && url.protocol !== "http:") || link.length > 200) {
      errors.links = "Links must be full http(s) URLs, one per line.";
    }
  }

  const consent = form.get("consent") === "on";
  if (consent && !email) errors.consent = "Add an email so we can contact you.";

  const answers: Answers = {
    displayName,
    email,
    location: text("location", 80),
    contributions,
    hardware,
    noHardware,
    gpuDetails: text("gpuDetails", 500),
    hoursPerWeek: hours,
    experience: experience as Answers["experience"],
    links,
    why: text("why", 2000),
    heardFrom: text("heardFrom", 200),
    consent,
  };
  return { answers, errors };
}

export interface Device {
  kind: HardwareKind;
  label: string;
  count: number;
}

/** Hardware the person declared at sign-up, largest first. Declared, never connected: there is no Node app yet. */
export function declaredDevices(a: Answers): Device[] {
  if (a.noHardware) return [];
  return (Object.entries(a.hardware) as [HardwareKind, number][])
    .filter(([, n]) => n > 0)
    .map(([kind, count]) => ({ kind, label: HARDWARE[kind], count }))
    .sort((x, y) => y.count - x.count);
}

export const deviceTotal = (devices: Device[]) => devices.reduce((n, d) => n + d.count, 0);

/** Declared devices by vendor, for the hardware-mix donut. */
export function vendorMix(devices: Device[]): { label: string; value: number }[] {
  const of = (...kinds: HardwareKind[]) => devices.filter((d) => kinds.includes(d.kind)).reduce((n, d) => n + d.count, 0);
  return [
    { label: "NVIDIA", value: of("nvidia_consumer", "nvidia_datacenter") },
    { label: "Apple Silicon", value: of("apple") },
    { label: "AMD", value: of("amd") },
    { label: "Google TPU", value: of("tpu") },
  ];
}

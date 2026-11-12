// GitHub OAuth (scope `read:user user:email`) and the operator authorisation rule.
export const ORG = "OpenFrontierLabs";
export const SCOPE = "read:user user:email";

export interface GitHubProfile {
  id: number;
  login: string;
  avatarUrl: string;
  name: string;
  email: string;
  orgRole: string | null;
}

/**
 * Operators: active admins of the org (role read with the user's own token at login), plus the
 * ADMIN_GITHUB_LOGINS fallback (comma-separated, case-insensitive) for when GitHub does not
 * reveal the membership to this token's scopes.
 */
export function isOperator(login: string, orgRole: string | null, adminLogins: string): boolean {
  if (orgRole === "admin") return true;
  const wanted = login.toLowerCase();
  return adminLogins.split(",").some((l) => l.trim().toLowerCase() === wanted && wanted !== "");
}

const api = (path: string, token: string) =>
  fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "openfrontier-labs" },
    signal: AbortSignal.timeout(10_000),
  });

export async function exchangeCode(code: string, clientId: string, clientSecret: string, redirectUri: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "openfrontier-labs" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !body.access_token) throw new Error(`GitHub token exchange failed: ${body.error ?? res.status}`);
  return body.access_token;
}

export async function fetchProfile(token: string): Promise<GitHubProfile> {
  const userRes = await api("/user", token);
  if (!userRes.ok) throw new Error(`GitHub /user failed: ${userRes.status}`);
  const user = (await userRes.json()) as { id: number; login: string; avatar_url?: string; name?: string | null };
  const [emailsRes, memberRes] = await Promise.all([api("/user/emails", token), api(`/user/memberships/orgs/${ORG}`, token)]);
  const emails = emailsRes.ok ? ((await emailsRes.json()) as { email: string; primary: boolean; verified: boolean }[]) : [];
  const member = memberRes.ok ? ((await memberRes.json()) as { role?: string; state?: string }) : null;
  return {
    id: user.id,
    login: user.login,
    avatarUrl: user.avatar_url ?? "",
    name: user.name ?? "",
    email: emails.find((e) => e.primary && e.verified)?.email ?? "",
    orgRole: member?.state === "active" ? (member.role ?? null) : null,
  };
}

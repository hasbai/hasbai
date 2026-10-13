export const authConfig = {
  domain: "auth.hasbai.xyz",
  clientId: "mdmD7xvX5yay52SRVZeuIOhGHIa0Wdl2",
  audience: "https://financial.hasbai.xyz/api",
  organization: "org_qR4E7HTZE1Zv10go",
} as const;
export const authClaims = { role: "role", roles: "_roles", username: "username", email: "email" } as const;

export const permissions = {
  financial: "financial.all:all",
  blog: "blog.all:all",
  tavern: "tavern.all:all",
  zboard: "zboard.all:all",
} as const;

/** Use only after the API has verified the JWT. */
export function hasPermission(claims: unknown, permission: string): boolean {
  if (typeof claims !== "object" || claims === null || !("permissions" in claims)) return false;
  return Array.isArray(claims.permissions) && claims.permissions.includes(permission);
}

/** UI gating for SDK-issued tokens; APIs still verify signatures and authorization. */
export function tokenHasPermission(token: string | undefined, permission: string): boolean {
  if (!token) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const claims: unknown = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return hasPermission(claims, permission);
  } catch {
    return false;
  }
}

import { Auth0Client } from "@auth0/auth0-spa-js";
import { authConfig } from "./config";
export { authConfig, authClaims } from "./config";
/** Invoke only in the browser. The SDK persists sessions and rotates refresh tokens. */
export function createBrowserClient(
  origin: string,
  options: { audience?: string } = {},
) {
  return new Auth0Client({
    domain: authConfig.domain,
    clientId: authConfig.clientId,
    cacheLocation: "localstorage",
    useRefreshTokens: true,
    useRefreshTokensFallback: true,
    authorizeTimeoutInSeconds: 3,
    authorizationParams: {
      redirect_uri: `${origin}/auth/callback`,
      audience: options.audience ?? authConfig.audience,
      scope: "openid profile email",
      organization: authConfig.organization,
    },
  });
}
export type { Auth0Client, User } from "@auth0/auth0-spa-js";

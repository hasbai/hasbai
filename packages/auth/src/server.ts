import { createRemoteJWKSet, jwtVerify } from "jose";
import { authConfig } from "./config";

const jwks = createRemoteJWKSet(new URL(`https://${authConfig.domain}/.well-known/jwks.json`));

/** Verify a user access token before using permissions or forwarding it to an API. */
export async function verifyUserToken(token: string) {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `https://${authConfig.domain}/`, audience: authConfig.audience,
    algorithms: ["RS256"], requiredClaims: ["sub", "exp", "iat"],
  });
  if (!payload.sub || payload.sub.endsWith("@clients")) throw new Error("Not a user token");
  return payload;
}

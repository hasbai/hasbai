import { env } from "$env/dynamic/public";
import { dataApiUrl } from "@hasbai/data";
import { repository } from "./api";
export const anonymousAuthUrl =
  "https://ep-long-dew-b3q1him6.neonauth.c-4.ap-southeast-1.aws.neon.tech/neondb/auth";
let browserToken: Promise<string> | undefined;
let browserTokenUntil = 0;
/** A short-lived, public guest JWT; no session, secret, or backend proxy. */
export function publicRepository(locale = "zh-CN") {
  let pending: Promise<string> | undefined;
  const token = () => {
    if (
      typeof window !== "undefined" &&
      browserToken &&
      Date.now() < browserTokenUntil
    )
      return browserToken;
    const request = (pending ??= fetch(
      `${env.PUBLIC_ANONYMOUS_AUTH_URL || anonymousAuthUrl}/token/anonymous`,
      { credentials: "omit" },
    ).then(async (response) => {
      if (!response.ok) throw new Error("匿名访问暂时不可用");
      const body = (await response.json()) as { token?: string };
      if (!body.token) throw new Error("匿名访问暂时不可用");
      return body.token;
    }));
    if (typeof window !== "undefined") {
      browserToken = request;
      browserTokenUntil = Date.now() + 60_000;
      request.catch(() => {
        if (browserToken === request) browserToken = undefined;
      });
    }
    return request;
  };
  return repository(token, env.PUBLIC_DATA_API_URL || dataApiUrl, locale);
}

import { env } from "$env/dynamic/public";
import { repository } from "$lib/api";
export function neonPublicRepository(locale = "zh-CN") {
  let token: Promise<string> | undefined;
  return repository(
    () =>
      (token ??= fetch(
        `${env.PUBLIC_ANONYMOUS_AUTH_URL || "https://ep-long-dew-b3q1him6.neonauth.c-4.ap-southeast-1.aws.neon.tech/neondb/auth"}/token/anonymous`,
        { credentials: "omit" },
      ).then(async (response) => {
        if (!response.ok) throw new Error("匿名访问暂时不可用");
        const body = (await response.json()) as { token: string };
        if (!body.token) throw new Error("匿名访问暂时不可用");
        return body.token;
      })),
    undefined,
    locale,
  );
}

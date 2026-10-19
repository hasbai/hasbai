import { defaultLocales } from "$lib/locales";

export const localeKey = "blog:supported-locales";
export async function supportedLocales(env?: App.Platform["env"]): Promise<string[]> {
  return (await env?.BLOG_SETTINGS?.get<string[]>(localeKey, "json")) ?? defaultLocales;
}

export async function localesResponse(env?: App.Platform["env"], method = "GET") {
  let response: Response;
  try {
    const locales = await supportedLocales(env);
    response = Response.json({ locales, available: [...new Set([...defaultLocales, ...locales])] });
  } catch {
    response = Response.json({ message: "服务暂时不可用" }, { status: 503 });
  }
  return method === "HEAD" ? new Response(null, response) : response;
}

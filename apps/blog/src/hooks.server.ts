import { observeRequest } from "@hasbai/observability";
import { localeFromPath, withoutLocale } from "$lib/locales";
import { localesResponse, supportedLocales } from "$lib/server/settings";
import type { Handle } from "@sveltejs/kit";
export const handle: Handle = async ({ event, resolve }) =>
 observeRequest(event.request, "blog", event.platform?.env.VERSION?.id, async () => {
  const path = event.url.pathname;
  const locales =
    path.startsWith("/api/") || path.startsWith("/images/")
      ? undefined
      : await supportedLocales(event.platform?.env);
  const response =
    path === "/api/locales" && (event.request.method === "GET" || event.request.method === "HEAD")
      ? await localesResponse(event.platform?.env, event.request.method)
      : path === "/api" || path.startsWith("/api/") || path.startsWith("/images/")
      ? await (await import("$lib/server/http")).blogHttp.fetch(event.request, { platform: event.platform })
      : await resolve(event, {
          transformPageChunk: ({ html }) =>
            html.replace(
              /<html lang="[^"]*"/,
              `<html lang="${localeFromPath(path, locales)}"`,
            ),
        });
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  if (
    withoutLocale(event.url.pathname).startsWith("/studio") ||
    event.url.pathname.startsWith("/auth") ||
    event.url.pathname.startsWith("/api")
  )
    response.headers.set("Cache-Control", "private,no-store");
  return response;
});

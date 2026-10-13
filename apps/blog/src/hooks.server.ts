import { localeFromPath, withoutLocale } from "$lib/locales";
import { supportedLocales } from "$lib/server/translation";
import type { Handle } from "@sveltejs/kit";
import { blogHttp } from "$lib/server/http";
export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  const locales =
    path.startsWith("/api/") || path.startsWith("/images/")
      ? undefined
      : await supportedLocales(event.platform?.env);
  const response =
    path === "/api" || path.startsWith("/api/") || path.startsWith("/images/")
      ? await blogHttp.fetch(event.request, { platform: event.platform })
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
};

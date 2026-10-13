import type { Handle } from "@sveltejs/kit";
import { blogHttp } from "$lib/server/http";
export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  const response = path === "/api" || path.startsWith("/api/") || path.startsWith("/images/")
    ? await blogHttp.fetch(event.request, { platform: event.platform })
    : await resolve(event);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  if (
    event.url.pathname.startsWith("/studio") ||
    event.url.pathname.startsWith("/auth") ||
    event.url.pathname.startsWith("/api")
  )
    response.headers.set("Cache-Control", "private,no-store");
  return response;
};

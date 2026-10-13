import type { Reroute } from "@sveltejs/kit";
import { withoutLocale, localeSegment } from "$lib/locales";
export const reroute: Reroute = async ({ url, fetch }) => {
  const path = withoutLocale(url.pathname);
  if (path !== url.pathname) return path;
  const first = localeSegment(url.pathname);
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(first) || first === "api")
    return;
  const response = await fetch("/api/locales");
  if (!response.ok) return;
  const { available } = (await response.json()) as { available: string[] };
  return withoutLocale(url.pathname, available);
};

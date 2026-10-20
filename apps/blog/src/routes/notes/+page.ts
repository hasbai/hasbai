import type { PageLoad } from "./$types";
import { localeFromPath, localizedPath } from "$lib/locales";
import { error } from "@sveltejs/kit";
import { pageNumber } from "$lib/content";
import { publicRepository } from "$lib/public-api";

export const load: PageLoad = async ({ url, parent, fetch }) => {
  const { locale } = await parent();
  try {
    const page = pageNumber(url.searchParams.get("page"));
    const rows = await publicRepository(locale, fetch).notes({ page });
    return { notes: rows.slice(0, 12), more: rows.length > 12, page };
  } catch {
    error(503, "手记暂时无法加载");
  }
};

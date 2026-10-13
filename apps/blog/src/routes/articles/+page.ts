import type { PageLoad } from "./$types";
import { localeFromPath, localizedPath } from "$lib/locales";
import { error } from "@sveltejs/kit";
import { pageNumber } from "$lib/content";
import { publicRepository } from "$lib/public-api";

export const load: PageLoad = async ({ url, parent }) => {
  const { locale } = await parent();
  try {
    const page = pageNumber(url.searchParams.get("page"));
    const repo = publicRepository(locale);
    const [rows, tags] = await Promise.all([
      repo.articles({ page }),
      repo.tags(),
    ]);
    return { articles: rows.slice(0, 12), more: rows.length > 12, page, tags };
  } catch {
    error(503, "文章暂时无法加载");
  }
};

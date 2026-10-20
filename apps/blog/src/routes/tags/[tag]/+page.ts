import type { PageLoad } from "./$types";
import { localeFromPath, localizedPath } from "$lib/locales";
import { pageNumber } from "$lib/content";
import { error } from "@sveltejs/kit";
import { publicRepository } from "$lib/public-api";

export const load: PageLoad = async ({ params, url, parent, fetch }) => {
  const { locale } = await parent();
  const repo = publicRepository(locale, fetch);
  const tags = await repo.tags();
  const tag = tags.find((item) => item.slug === params.tag);
  if (!tag) error(404, "标签不存在");
  const page = pageNumber(url.searchParams.get("page"));
  const rows = await repo.articles({ tag: tag.id, page });
  return {
    articles: rows.slice(0, 12),
    more: rows.length > 12,
    page,
    tag,
    tags,
  };
};

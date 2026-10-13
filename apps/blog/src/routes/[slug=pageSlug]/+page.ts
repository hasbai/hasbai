import { localeFromPath, localizedPath } from "$lib/locales";
import { error } from "@sveltejs/kit";
import { publicRepository } from "$lib/public-api";
import { renderMarkdown } from "$lib/markdown";
import type { PageLoad } from "./$types";
export const load: PageLoad = async ({ params, url, parent }) => {
  const { locale } = await parent();
  let page;
  try {
    page = await publicRepository(locale).pageBySlug(params.slug);
  } catch {
    error(503, "页面暂时无法加载");
  }
  if (
    !page ||
    page.status !== "published" ||
    !page.published_at ||
    new Date(page.published_at) > new Date()
  )
    error(404, "页面不存在");
  return { page, html: await renderMarkdown(page.markdown) };
};

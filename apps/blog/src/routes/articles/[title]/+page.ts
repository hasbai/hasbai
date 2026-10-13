import type { PageLoad } from "./$types";
import { localeFromPath, localizedPath } from "$lib/locales";
import { redirect } from "@sveltejs/kit";
import { articlePath } from "$lib/content";
import { loadArticle } from "$lib/load-article";
import { publicRepository } from "$lib/public-api";

export const load: PageLoad = async ({ params, url, parent }) => {
  const { locale } = await parent();
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(params.title)) {
    const article = await publicRepository(locale).article(params.title);
    if (
      article?.status === "published" &&
      article.published_at &&
      new Date(article.published_at) <= new Date()
    )
      redirect(308, localizedPath(articlePath(article), locale));
  }
  return loadArticle(params.title, locale);
};

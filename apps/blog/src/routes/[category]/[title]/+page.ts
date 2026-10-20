import type { PageLoad } from "./$types";
import { localeFromPath, localizedPath } from "$lib/locales";
import { error, redirect } from "@sveltejs/kit";
import { articlePath } from "$lib/content";
import { publicRepository } from "$lib/public-api";

export const load: PageLoad = async ({ params, url, parent, fetch }) => {
  const { locale } = await parent();
  const article = await publicRepository(locale, fetch).articleByLegacyPath(
    `/${params.category}/${params.title}`,
  );
  if (!article) error(404, "文章不存在");
  redirect(308, localizedPath(articlePath(article), locale));
};

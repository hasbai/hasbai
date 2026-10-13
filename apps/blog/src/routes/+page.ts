import type { PageLoad } from "./$types";
import { localeFromPath, localizedPath } from "$lib/locales";
import { error } from "@sveltejs/kit";
import { publicRepository } from "$lib/public-api";

export const load: PageLoad = async ({ url, parent }) => {
  const { locale } = await parent();
  try {
    const repo = publicRepository(locale);
    const [articles, notes] = await Promise.all([
      repo.articles({ limit: 6 }),
      repo.notes({ limit: 6 }),
    ]);
    const recent = [...articles.slice(0, 6), ...notes.slice(0, 6)]
      .sort((a, b) =>
        (b.published_at ?? "").localeCompare(a.published_at ?? ""),
      )
      .slice(0, 6);
    return { recent };
  } catch {
    error(503, "内容暂时无法加载");
  }
};

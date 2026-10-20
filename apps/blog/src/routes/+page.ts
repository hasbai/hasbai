import type { PageLoad } from "./$types";
import { localeFromPath, localizedPath } from "$lib/locales";
import { error } from "@sveltejs/kit";
import { publicRepository } from "$lib/public-api";

export const load: PageLoad = async ({ url, parent, fetch }) => {
  const { locale } = await parent();
  try {
    const repo = publicRepository(locale, fetch);
    const [articles, notes] = await Promise.all([
      repo.articles({ limit: 6 }),
      repo.notes({ limit: 6 }),
    ]);
    const recent = [...articles.slice(0, 6), ...notes.slice(0, 6)]
      .map(writing => {
        const time = Date.parse(writing.published_at ?? "");
        return { writing, time: Number.isFinite(time) ? time : -Infinity };
      })
      .sort((a, b) => b.time - a.time)
      .slice(0, 6)
      .map(({ writing }) => writing);
    return { recent };
  } catch {
    error(503, "内容暂时无法加载");
  }
};

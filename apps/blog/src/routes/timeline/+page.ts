import type { PageLoad } from "./$types";
import { localeFromPath, localizedPath } from "$lib/locales";
import { error } from "@sveltejs/kit";
import { publicRepository } from "$lib/public-api";
import type { Article, Note } from "$lib/content";

export const load: PageLoad = async ({ url, parent, fetch }) => {
  const { locale } = await parent();
  try {
    const repo = publicRepository(locale, fetch);
    async function collect<T>(getPage: (page: number) => Promise<T[]>) {
      const all: T[] = [];
      for (let page = 1; page <= 1000; page++) {
        const rows = await getPage(page);
        all.push(...rows.slice(0, 100));
        if (rows.length <= 100) return all;
      }
      return all;
    }
    const [articles, notes] = await Promise.all([
      collect<Article>((page) => repo.articles({ page, limit: 100 })),
      collect<Note>((page) => repo.notes({ page, limit: 100 })),
    ]);
    return {
      writings: [...articles, ...notes].sort((a, b) =>
        (b.published_at ?? "").localeCompare(a.published_at ?? ""),
      ),
    };
  } catch {
    error(503, "时间线暂时无法加载");
  }
};

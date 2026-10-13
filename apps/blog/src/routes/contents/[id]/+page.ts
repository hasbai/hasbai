import type { PageLoad } from "./$types";
import { localeFromPath, localizedPath } from "$lib/locales";
import { error, redirect } from "@sveltejs/kit";
import { articlePath, notePath, pagePath } from "$lib/content";
import { publicRepository } from "$lib/public-api";

export const load: PageLoad = async ({ params, url, parent }) => {
  const { locale } = await parent();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(params.id))
    error(404, "内容不存在");
  const repo = publicRepository(locale);
  const content = await repo.content(params.id);
  if (!content) error(404, "内容不存在");
  if (content.kind === "article") {
    const article = await repo.article(content.id);
    if (!article) error(404, "内容不存在");
    redirect(308, localizedPath(articlePath(article), locale));
  }
  if (content.kind === "note") {
    const note = await repo.note(content.id);
    if (!note) error(404, "内容不存在");
    redirect(308, localizedPath(notePath(note), locale));
  }
  if (content.kind === "page") {
    const page = await repo.page(content.id);
    if (!page) error(404, "内容不存在");
    redirect(308, localizedPath(pagePath(page), locale));
  }
  error(404, "内容不存在");
};

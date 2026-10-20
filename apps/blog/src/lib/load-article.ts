import { error } from "@sveltejs/kit";
import { publicRepository } from "./public-api";
import { renderPublicMarkdown } from "./public-markdown";
export async function loadArticle(slug: string, locale = "zh-CN", fetcher: typeof fetch = fetch) {
  const repo = publicRepository(locale, fetcher);
  const article = await repo.articleBySlug(slug);
  if (
    !article ||
    article.status !== "published" ||
    !article.published_at ||
    new Date(article.published_at) > new Date()
  )
    error(404, "文章不存在");
  const [html, tags] = await Promise.all([
    renderPublicMarkdown(article.markdown),
    repo.tagsForArticle(article.id),
  ]);
  return {
    article,
    html,
    tags,
  };
}

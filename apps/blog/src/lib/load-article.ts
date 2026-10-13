import { error } from "@sveltejs/kit";
import { publicRepository } from "./public-api";
import { renderMarkdown } from "./markdown";
export async function loadArticle(slug: string, locale = "zh-CN") {
  const repo = publicRepository(locale);
  const article = await repo.articleBySlug(slug);
  if (
    !article ||
    article.status !== "published" ||
    !article.published_at ||
    new Date(article.published_at) > new Date()
  )
    error(404, "文章不存在");
  const [html, tags] = await Promise.all([
    renderMarkdown(article.markdown),
    repo.tagsForArticle(article.id),
  ]);
  return {
    article,
    html,
    tags,
  };
}

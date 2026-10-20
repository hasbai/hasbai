import type { repository } from "./api";
export type PublicRepository = Pick<
  ReturnType<typeof repository>,
  | "tags"
  | "articles"
  | "notes"
  | "pages"
  | "article"
  | "articleBySlug"
  | "articleByLegacyPath"
  | "note"
  | "noteBySequence"
  | "page"
  | "pageBySlug"
  | "content"
  | "tagsForArticle"
>;
export function publicRepository(
  locale = "zh-CN",
  fetcher: typeof fetch = fetch,
): PublicRepository {
  const read = async (op: string, args: unknown[] = []) => {
    const query = new URLSearchParams({
      op,
      locale,
      args: JSON.stringify(args),
    });
    const response = await fetcher(`/api/public?${query}`, {
      credentials: "omit",
    });
    if (!response.ok) throw new Error("公开内容暂时不可用");
    return (await response.json()).data;
  };
  return {
    tags: () => read("tags"),
    articles: (options = {}) => read("articles", [options]),
    notes: (options = {}) => read("notes", [options]),
    pages: (options = {}) => read("pages", [options]),
    article: (id) => read("article", [id]),
    articleBySlug: (slug) => read("articleBySlug", [slug]),
    articleByLegacyPath: (path) => read("articleByLegacyPath", [path]),
    note: (id) => read("note", [id]),
    noteBySequence: (sequence) => read("noteBySequence", [sequence]),
    page: (id) => read("page", [id]),
    pageBySlug: (slug) => read("pageBySlug", [slug]),
    content: (id) => read("content", [id]),
    tagsForArticle: (id) => read("tagsForArticle", [id]),
  };
}

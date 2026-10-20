import { supportedLocales } from "./settings";
import { publicSearch } from "./public-search";
import { localize } from "$lib/api";
import type { Article, Note, Page, StudioContent } from "$lib/content";
import { defaultLocale } from "$lib/locales";
import {
  publicSnapshot,
  type PublicSnapshot,
  type PublicRow,
} from "./public-snapshot";

export function snapshotRepository(
  snapshot: PublicSnapshot,
  locale = defaultLocale,
) {
  const visible = snapshot.content.filter(
    (row) =>
      row.status === "published" &&
      row.published_at &&
      Date.parse(row.published_at) <= Date.now(),
  );
  const local = (row: PublicRow): StudioContent => {
    const { article_tag, ...content } = row;
    return localize(content, locale);
  };
  const tags = async () =>
    snapshot.tags
      .map((tag) => ({
        ...tag,
        name:
          tag.translations?.[locale] ||
          tag.translations?.[defaultLocale] ||
          Object.values(tag.translations ?? {})[0] ||
          tag.slug,
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  const one = async (
    kind: string | undefined,
    key: "id" | "slug" | "sequence" | "legacy_path",
    value: string | number,
  ) => {
    const row = visible.find(
      (row) =>
        (!kind || row.kind === kind) &&
        (key === "id"
          ? row.id === value
          : key === "slug"
            ? "slug" in row && row.slug === value
            : key === "sequence"
              ? "sequence" in row && row.sequence === value
              : "legacy_path" in row && row.legacy_path === value),
    );
    return row ? local(row) : null;
  };
  const list = async (
    kind: string,
    {
      page = 1,
      limit = 12,
      tag,
    }: { page?: number; limit?: number; tag?: string } = {},
  ) =>
    visible
      .filter(
        (row) =>
          row.kind === kind &&
          (!tag || row.article_tag?.some((link) => link.tag_id === tag)),
      )
      .sort(
        (a, b) =>
          (b.published_at ?? "").localeCompare(a.published_at ?? "") ||
          a.id.localeCompare(b.id),
      )
      .slice((page - 1) * limit, page * limit + 1)
      .map((row) => ({ ...local(row), markdown: "" }));
  return {
    tags,
    articles: async (options = {}) =>
      (await list("article", options)).filter(
        (row): row is Article => row.kind === "article",
      ),
    notes: async (options = {}) =>
      (await list("note", options)).filter(
        (row): row is Note => row.kind === "note",
      ),
    pages: async (options = {}) =>
      (await list("page", options)).filter(
        (row): row is Page => row.kind === "page",
      ),
    article: (id: string) => one("article", "id", id),
    articleBySlug: (slug: string) => one("article", "slug", slug),
    articleByLegacyPath: (path: string) => one("article", "legacy_path", path),
    note: (id: string) => one("note", "id", id),
    noteBySequence: (sequence: number) => one("note", "sequence", sequence),
    page: (id: string) => one("page", "id", id),
    pageBySlug: (slug: string) => one("page", "slug", slug),
    content: (id: string) => one(undefined, "id", id),
    tagsForArticle: async (id: string) => {
      const ids = new Set(
        visible
          .find((row) => row.id === id && row.kind === "article")
          ?.article_tag?.map((link) => link.tag_id),
      );
      return (await tags()).filter((tag) => ids.has(tag.id));
    },
    search: async (
      kind: string,
      query: string | undefined,
      page: number,
      limit: number,
    ) => {
      return visible
        .filter(
          (row) =>
            row.kind === kind &&
            (!query ||
              row.translation.some((t) =>
                [t.title, t.excerpt, t.markdown].some((value) =>
                  publicSearch(value ?? "", query),
                ),
              )),
        )
        .sort(
          (a, b) =>
            (b.published_at ?? "").localeCompare(a.published_at ?? "") ||
            a.id.localeCompare(b.id),
        )
        .slice((page - 1) * limit, page * limit + 1)
        .map((row) => ({
          ...local(row),
          markdown: "",
          article_tag: undefined,
        }));
    },
  };
}
export async function cachedPublicRepository(
  env?: App.Platform["env"],
  locale = defaultLocale,
) {
  const enabled = await supportedLocales(env);
  return snapshotRepository(
    await publicSnapshot(env),
    enabled.includes(locale) ? locale : defaultLocale,
  );
}

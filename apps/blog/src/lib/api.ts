import { env } from "$env/dynamic/public";
import { createDataClient, dataApiUrl } from "@hasbai/data";
import { defaultLocale } from "./locales";
import type { Translation } from "./content";
import type { Article, Content, Note, Page, Tag, StudioContent } from "./content";

const metadata =
  "id,kind,source_locale,sequence,slug,legacy_path,cover_id,status,published_at,created_at,updated_at";
export function localize<T extends Content>(
  row: T & { translation?: Translation[] },
  locale: string,
): T {
  const translations = (row.translation ?? []).filter(t=>row.status==="draft" || (t.is_complete !== false && (t.markdown===undefined || !!t.markdown.trim())));
  const selected =
    translations.find((t) => t.locale === locale) ??
    translations.find((t) => t.locale === defaultLocale) ??
    translations.find((t) => t.locale === row.source_locale) ??
    translations[0];
  return Object.assign({}, row, {
    translation: undefined,
    title: selected?.title ?? "",
    excerpt: selected?.excerpt ?? "",
    markdown: selected?.markdown ?? "",
    locale: selected?.locale ?? locale,
    translation_updated_at: selected?.updated_at,
  });
}
export function repository(
  token?: () => Promise<string>,
  url = env.PUBLIC_DATA_API_URL || dataApiUrl,
  locale = defaultLocale,
) {
  const db = createDataClient(url, "public", token);
  async function read<T>(
    query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  ): Promise<T> {
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    return result.data as T;
  }

  const columns = (body = true) =>
    `${metadata},translation(content_id,locale,title,excerpt,is_complete,updated_at${body ? ",markdown" : ""})`;
  async function one<T extends Content>(
    kind: string | undefined,
    key: string,
    value: string | number,
    published = false,
  ) {
    let q = db.from("content").select(columns()).eq(key, value);
    if (kind) q = q.eq("kind", kind);
    if (published)
      q = q
        .eq("status", "published")
        .lte("published_at", new Date().toISOString());
    const row = await read<(T & { translation?: Translation[] }) | null>(
      q.maybeSingle(),
    );
    return row ? localize(row, locale) : null;
  }
  async function list<T extends Content>(
    kind: string,
    page = 1,
    limit = 12,
    studio = false,
    tag?: string,
  ) {
    let q = db
      .from("content")
      .select(columns(false))
      .eq("kind", kind)
      .order(kind === "page" ? "updated_at" : "published_at", {
        ascending: false,
        nullsFirst: false,
      })
      .order("id");
    if (!studio)
      q = q
        .eq("status", "published")
        .lte("published_at", new Date().toISOString());
    if (tag) {
      const links = await read<{ article_id: string }[]>(
        db.from("article_tag").select("article_id").eq("tag_id", tag),
      );
      if (!links.length) return [] as T[];
      q = q.in(
        "id",
        links.map((link) => link.article_id),
      );
    }
    return (
      await read<(T & { translation?: Translation[] })[]>(
        q.range((page - 1) * limit, page * limit),
      )
    ).map((row) => localize(row, locale));
  }
  const tags = async () =>
    (
      await read<
        { id: string; slug: string; translations: Record<string, string> }[]
      >(db.from("tag").select("id,slug,translations").order("slug"))
    ).map((tag) => ({
      ...tag,
      name:
        tag.translations?.[locale] ||
        tag.translations?.[defaultLocale] ||
        Object.values(tag.translations ?? {})[0] ||
        tag.slug,
    }));
  async function save<T extends Content>(
    kind: string,
    value: unknown,
    id?: string,
    updatedAt?: string,
  ) {
    const { articleSchema, noteSchema, pageSchema } = await import("./content-schema");
    const parsed = (kind === "article" ? articleSchema : kind === "page" ? pageSchema : noteSchema).safeParse(value);
    if(!parsed.success) throw new Error(parsed.error.issues[0].message);
    const fields=parsed.data;
    if (typeof window !== "undefined") {
      const response = await fetch("/api/content", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + (await token!()),
        },
        body: JSON.stringify({
          kind,
          value: fields,
          id,
          updated_at: updatedAt,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "保存失败");
      return result.item as T;
    }
    const saved = await read<Content>(
      db
        .rpc("save_content", {
          p_id: id ?? crypto.randomUUID(),
          p_kind: kind,
          p_updated_at: updatedAt ?? null,
          p_locale: fields.locale,
          p_value: fields,
        })
        .single(),
    );
    return (await one<T>(kind, "id", saved.id))!;
  }
  return {
    db,
    tags,
    async snapshot(id: string) {
      const row = await read<StudioContent & {translation: Translation[];article_tag:{tag_id:string}[]}>(db.from('content').select(`${columns()},article_tag(tag_id)`).eq('id',id).single());
      return Object.assign(localize(row,locale),{article_tag:undefined,translations:row.translation,tag_ids:row.article_tag.map(t=>t.tag_id)});
    },
    locales: () => read<string[]>(db.rpc("blog_locales")),
    articles: ({
      tag,
      page = 1,
      limit = 12,
      studio = false,
    }: {
      tag?: string;
      page?: number;
      limit?: number;
      studio?: boolean;
    } = {}) => list<Article>("article", page, limit, studio, tag),
    notes: ({
      page = 1,
      limit = 12,
      studio = false,
    }: { page?: number; limit?: number; studio?: boolean } = {}) =>
      list<Note>("note", page, limit, studio),
    pages: ({ page = 1, limit = 12 }: { page?: number; limit?: number } = {}) =>
      list<Page>("page", page, limit, true),
    page: (id: string) => one<Page>("page", "id", id),
    pageBySlug: (slug: string) => one<Page>("page", "slug", slug, true),
    content: (id: string) => one<Content>(undefined, "id", id),
    article: (id: string) => one<Article>("article", "id", id),
    articleBySlug: (slug: string) =>
      one<Article>("article", "slug", slug, true),
    articleByLegacyPath: (path: string) =>
      one<Article>("article", "legacy_path", path, true),
    note: (id: string) => one<Note>("note", "id", id),
    noteBySequence: (sequence: number) =>
      one<Note>("note", "sequence", sequence, true),
    translations: (id: string) =>
      read<Translation[]>(
        db.from("translation").select("*").eq("content_id", id).order("locale"),
      ),
    tagsForArticle: async (id: string) => {
      const [links, all] = await Promise.all([
        read<{ tag_id: string }[]>(
          db.from("article_tag").select("tag_id").eq("article_id", id),
        ),
        tags(),
      ]);
      const ids = new Set(links.map((link) => link.tag_id));
      return all.filter((tag) => ids.has(tag.id));
    },
    saveArticle: (value: unknown, id?: string, updatedAt?: string) =>
      save<Article>("article", value, id, updatedAt),
    saveNote: (value: unknown, id?: string, updatedAt?: string) =>
      save<Note>("note", value, id, updatedAt),
    savePage: (value: unknown, id?: string, updatedAt?: string) =>
      save<Page>("page", value, id, updatedAt),
    async remove(kind: string, id: string, updatedAt: string) {
      const rows = await read<{ id: string }[]>(
        db
          .from("content")
          .delete()
          .eq("kind", kind)
          .eq("id", id)
          .eq("updated_at", updatedAt)
          .select("id"),
      );
      if (!rows.length) throw new Error("内容已被更新，请重新打开");
    },
    createTag: (name: string, slug: string) =>
      read<Tag>(
        db
          .from("tag")
          .insert({ translations: { [defaultLocale]: name.trim() }, slug })
          .select("*")
          .single(),
      ).then((tag) => ({ ...tag, name })),
  };
}

import { stripFrontmatter } from "@hasbai/markdown/frontmatter";
import { formatDate } from "./dates";
import { localizedPath } from "./locales";

export const site = { name: "北极小站", origin: "https://hasbai.xyz" };
export type Tag = {
  id: string;
  name: string;
  slug: string;
  translations?: Record<string, string>;
};
export type Translation = {
  is_complete?: boolean;
  content_id: string;
  locale: string;
  title: string;
  excerpt: string;
  markdown: string;
  updated_at: string;
};
export type ImageRecord = {
  id: string;
  name: string;
  sha256: string;
  content_type: string;
  size: number;
  ready: boolean;
};
export type Content = {
  id: string;
  kind: "article" | "note" | "page";
  translations?: Translation[];
  tag_ids?: string[];
  locale?: string;
  source_locale?: string;
  translation_updated_at?: string;
  translation_warning?: string;
  excerpt: string;
  markdown: string;
  cover_id: string | null;
  status: "draft" | "published";
  published_at: string | null;
  created_at: string;
  updated_at: string;
};
export type Article = Content & {
  kind: "article";
  sequence: number;
  title: string;
  slug: string;
  legacy_path: string | null;
};
export type Note = Content & {
  kind: "note";
  sequence: number;
};
export type Page = Content & {
  kind: "page";
  title: string;
  slug: string;
};
export type Writing = Article | Note;
export type StudioContent = Writing | Page;
export function pagePath(page: Pick<Page, "slug"> & { locale?: string }) {
  return localizedPath(`/${encodeURIComponent(page.slug)}`, page.locale);
}

export function articlePath(
  article: Pick<Article, "slug"> & { locale?: string },
) {
  return localizedPath(
    `/articles/${encodeURIComponent(article.slug)}`,
    article.locale,
  );
}
export function notePath(note: Pick<Note, "sequence"> & { locale?: string }) {
  return localizedPath(`/notes/${note.sequence}`, note.locale);
}
export function writingPath(writing: Writing) {
  return writing.kind === "article" ? articlePath(writing) : notePath(writing);
}
export function imagePath(id: string) {
  return `/images/${encodeURIComponent(id)}`;
}
let yearLabelFormatter: Intl.DateTimeFormat | undefined;
export function dateLabel(value: string | null) {
  if (!value) return "草稿";
  return formatDate(value, "zh-CN");
}
export function yearLabel(value: string | null) {
  if (!value) return "草稿";
  yearLabelFormatter ??= new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric" });
  return yearLabelFormatter.format(new Date(value));
}
export function readMinutes(markdown: string) {
  return Math.max(1, Math.ceil(markdown.replace(/\s/g, "").length / 450));
}
export function excerptFromMarkdown(markdown: string) {
  return stripFrontmatter(markdown)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[#>*`\-\s]+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}
export function pageNumber(value: string | null) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(1, Math.min(10000, Math.floor(number)))
    : 1;
}

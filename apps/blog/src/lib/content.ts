import { stripFrontmatter } from "@hasbai/markdown/metadata";
import { localizedPath } from "./locales";
import { z } from "zod";

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
export const reservedPageSlugs = [
  "articles",
  "notes",
  "timeline",
  "tags",
  "contents",
  "studio",
  "auth",
  "api",
  "images",
  "assets",
  "en",
  "zh",
  "en-us",
  "zh-cn",
  "zh-tw",
];

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,159}$/, "网址只使用小写字母、数字和连字符");
export const pageSlugSchema = slugSchema.refine(
  (slug) => !reservedPageSlugs.includes(slug),
  "该路径已用于网站功能，请换一个路径",
);
const commonFields = {
  locale: z.string().min(2).max(35).default("zh-CN"),
  excerpt: z.string().max(600),
  markdown: z.string().max(1048576),
  cover_id: z.string().uuid().nullable(),
  status: z.enum(["draft", "published"]),
  published_at: z.string().nullable(),
};
function publicationCheck(
  value: {
    status: "draft" | "published";
    markdown: string;
    published_at: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if (
    value.status === "published" &&
    (!value.markdown.trim() || !value.published_at)
  )
    ctx.addIssue({
      code: "custom",
      message: "发布前请填写正文",
      path: ["markdown"],
    });
}
export const articleSchema = z
  .object({
    title: z.string().trim().min(1, "请填写标题").max(240),
    slug: slugSchema,
    tag_ids: z.array(z.string().uuid()).max(30),
    ...commonFields,
  })
  .superRefine(publicationCheck);
export const pageSchema = z
  .object({
    title: z.string().trim().min(1, "请填写标题").max(240),
    slug: pageSlugSchema,
    ...commonFields,
  })
  .superRefine(publicationCheck);
export function pagePath(page: Pick<Page, "slug"> & { locale?: string }) {
  return localizedPath(`/${encodeURIComponent(page.slug)}`, page.locale);
}
export const noteSchema = z.object(commonFields).superRefine(publicationCheck);

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
const dateLabelFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric",
});
const yearLabelFormatter = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Shanghai", year: "numeric",
});
export function dateLabel(value: string | null) {
  return value
    ? dateLabelFormatter.format(new Date(value))
    : "草稿";
}
export function yearLabel(value: string | null) {
  return value
    ? yearLabelFormatter.format(new Date(value))
    : "草稿";
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

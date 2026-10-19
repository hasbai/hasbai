import { z } from "zod";
import { slugPattern, reservedPageSlugs } from "./content-paths";

export const slugSchema = z
  .string()
  .regex(slugPattern, "网址只使用小写字母、数字和连字符");
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
export const noteSchema = z.object(commonFields).superRefine(publicationCheck);

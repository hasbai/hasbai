import { Hono } from "hono";
import { z } from "zod";
import type { BlogBindings } from "./http";
import { cachedPublicRepository } from "./public-reader";
import { supportedLocales } from "./settings";
const operations = [
  "tags",
  "articles",
  "notes",
  "pages",
  "article",
  "articleBySlug",
  "articleByLegacyPath",
  "note",
  "noteBySequence",
  "page",
  "pageBySlug",
  "content",
  "tagsForArticle",
] as const;
const options = z
  .object({
    page: z.number().int().min(1).max(10000).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    tag: z.string().uuid().optional(),
  })
  .strict();
export const publicRoutes = new Hono<{ Bindings: BlogBindings }>();
publicRoutes.get("/api/public", async (c) => {
  c.header("Cache-Control", "no-store");
  const op = z.enum(operations).safeParse(c.req.query("op"));
  const locale = z
    .string()
    .min(2)
    .max(32)
    .safeParse(c.req.query("locale") ?? "zh-CN");
  let args: unknown;
  try {
    args = JSON.parse(c.req.query("args") ?? "[]");
  } catch {
    return c.json({ message: "读取参数无效" }, 400);
  }
  if (!op.success || !locale.success)
    return c.json({ message: "读取参数无效" }, 400);
  const method = op.data;
  const schema =
    method === "tags"
      ? z.tuple([])
      : ["articles", "notes", "pages"].includes(method)
        ? z.tuple([options])
        : method === "noteBySequence"
          ? z.tuple([z.number().int().positive()])
          : z.tuple([z.string().min(1).max(2048)]);
  const parsed = schema.safeParse(args);
  if (!parsed.success) return c.json({ message: "读取参数无效" }, 400);
  const enabled = await supportedLocales(c.env.platform?.env);
  const repo = await cachedPublicRepository(
    c.env.platform?.env,
    enabled.includes(locale.data) ? locale.data : "zh-CN",
  );
  // All operations are allowlisted and validated; no PostgREST filters or credentials cross this boundary.
  const values = parsed.data;
  let data: unknown;
  if (method === "tags") data = await repo.tags();
  else if (method === "articles" || method === "notes" || method === "pages")
    data = await repo[method](options.parse(values[0]));
  else if (method === "noteBySequence")
    data = await repo.noteBySequence(z.number().parse(values[0]));
  else data = await repo[method](z.string().parse(values[0]));
  c.header(
    "X-Blog-Source",
    c.env.platform?.env.BLOG_PUBLIC ? "r2" : "origin-local",
  );
  return c.json({ data });
});

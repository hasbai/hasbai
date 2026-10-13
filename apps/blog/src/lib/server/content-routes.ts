import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { hasPermission, permissions } from "@hasbai/auth/config";
import { verifyUserToken } from "@hasbai/auth/server";
import { z } from "zod";
import { repository } from "$lib/api";
import { defaultLocale, defaultLocales } from "$lib/locales";
import { articleSchema, noteSchema, pageSchema } from "$lib/content";
import type { BlogBindings } from "./http";
import {
  localeKey,
  registeredLocales,
  saveContent,
  supportedLocales,
  translateContent,
} from "./translation";
export const contentRoutes = new Hono<{
  Bindings: BlogBindings;
  Variables: { token: string };
}>();
contentRoutes.get("/api/locales", async c => {
 const locales=await supportedLocales(c.env.platform?.env);
 return c.json({locales,available:[...new Set([...defaultLocales,...locales])]});
});
contentRoutes.use("/api/content", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
contentRoutes.use("/api/translate", bodyLimit({ maxSize: 4096 }));
contentRoutes.use("/api/settings/locales", bodyLimit({ maxSize: 4096 }));
for (const path of ["/api/content", "/api/translate", "/api/settings/locales"])
  contentRoutes.use(path, async (c, next) => {
    const token = c.req.header("Authorization")?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) throw new HTTPException(401, { message: "请登录" });
    let claims;
    try {
      claims = await verifyUserToken(token);
    } catch {
      throw new HTTPException(401, { message: "登录已失效" });
    }
    if (!hasPermission(claims, permissions.blog))
      throw new HTTPException(403, { message: "无编辑权限" });
    c.set("token", token);
    await next();
  });
const version = {
  id: z.string().uuid(),
  updated_at: z.iso.datetime({ offset: true }),
};
const saveSchema = z
  .object({
    kind: z.enum(["article", "note", "page"]),
    value: z.unknown(),
    id: version.id.optional(),
    updated_at: version.updated_at.optional(),
  })
  .refine((v) => !!v.id === !!v.updated_at);
contentRoutes.post("/api/content", async (c) => {
  const parsed = saveSchema.safeParse(await c.req.json());
  if (!parsed.success)
    throw new HTTPException(400, { message: "保存参数无效" });
  const { kind, value, id, updated_at } = parsed.data;
  const fields = (
    kind === "article"
      ? articleSchema
      : kind === "note"
        ? noteSchema
        : pageSchema
  ).safeParse(value);
  if (!fields.success)
    throw new HTTPException(400, { message: fields.error.issues[0].message });
  if (
    !(await supportedLocales(c.env.platform?.env)).includes(fields.data.locale)
  )
    throw new HTTPException(400, { message: "语言未启用" });
  try {
    return c.json({
      item: await saveContent(
        repository(async () => c.get("token"), undefined, fields.data.locale),
        c.env.platform?.env,
        kind,
        fields.data,
        id,
        updated_at,
      ),
    });
  } catch (error) {
    throw new HTTPException(409, {
      message: error instanceof Error ? error.message : "保存失败",
    });
  }
});
contentRoutes.post("/api/translate", async (c) => {
  const parsed = z
    .object({ ...version, source: z.string(), target: z.string() })
    .safeParse(await c.req.json());
  if (!parsed.success)
    throw new HTTPException(400, { message: "翻译参数无效" });
  const { id, source, target, updated_at } = parsed.data;
  const env = c.env.platform?.env;
  if (!env) throw new HTTPException(503, { message: "翻译服务未配置" });
  const enabled = await supportedLocales(env);
  if (
    !enabled.includes(source) ||
    !enabled.includes(target) ||
    source === target
  )
    throw new HTTPException(400, { message: "语言无效" });
  const repo = repository(async () => c.get("token"), undefined, target);
  const item = await repo.content(id);
  if (!item || item.updated_at !== updated_at)
    throw new HTTPException(409, { message: "内容已更新，请重新打开" });
  try {
    await translateContent(repo, env, id, source, [target], false);
    return c.json({item:await repo.snapshot(id)});
  } catch (error) {
    throw new HTTPException(409, {
      message: error instanceof Error ? error.message : "翻译失败",
    });
  }
});
contentRoutes.get("/api/settings/locales", async (c) =>
  c.json({
    locales: await supportedLocales(c.env.platform?.env),
    available: await registeredLocales(),
  }),
);
contentRoutes.put("/api/settings/locales", async (c) => {
  const parsed = z
    .object({ locales: z.array(z.string()).min(1).max(30) })
    .safeParse(await c.req.json());
  if (!parsed.success)
    throw new HTTPException(400, { message: "语言列表无效" });
  const available = await registeredLocales();
  const locales = [...new Set(parsed.data.locales)];
  if (
    !locales.includes(defaultLocale) ||
    locales.some((l) => !available.includes(l))
  )
    throw new HTTPException(400, {
      message: "请保留简体中文，并选择已注册的语言",
    });
  const reserved = locales.flatMap(l=>[l.toLowerCase(),l.split('-')[0].toLowerCase()]);
  const collision=await repository(async()=>c.get('token')).db.from('content').select('id').eq('kind','page').in('slug',reserved);
  if(collision.error)throw new HTTPException(503,{message:'语言设置保存失败'});
  if(collision.data?.length)throw new HTTPException(409,{message:'语言前缀与页面路径冲突'});
  const kv = c.env.platform?.env.BLOG_SETTINGS;
  if (!kv) throw new HTTPException(503, { message: "语言设置未配置" });
  await kv.put(localeKey, JSON.stringify(locales));
  return c.json({ locales });
});

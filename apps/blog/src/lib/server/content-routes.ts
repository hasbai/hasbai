import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { hasPermission, permissions } from "@hasbai/auth/config";
import { verifyUserToken } from "@hasbai/auth/server";
import { z } from "zod";
import { repository } from "$lib/api";
import { defaultLocale, defaultLocales } from "$lib/locales";
import { articleSchema, noteSchema, pageSchema, slugSchema } from "$lib/content-schema";
import { PublicCacheError, refreshPublicSnapshot } from "./public-snapshot";
import { localesResponse } from "./settings";
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
contentRoutes.get("/api/locales", c => localesResponse(c.env.platform?.env, c.req.method));
contentRoutes.use("/api/content", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
contentRoutes.use("/api/translate", bodyLimit({ maxSize: 4096 }));
contentRoutes.use("/api/settings/locales", bodyLimit({ maxSize: 4096 }));
for (const path of ["/api/content", "/api/translate", "/api/settings/locales", "/api/tags"])
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
    const repo=repository(async () => c.get("token"), undefined, fields.data.locale, publishedAt=>refreshPublicSnapshot(c.env.platform?.env,repo,publishedAt));
    return c.json({
      item: await saveContent(
        repo,
        c.env.platform?.env,
        kind,
        fields.data,
        id,
        updated_at,
      ),
    });
  } catch (error) {
    if(error instanceof PublicCacheError)throw error;
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
    if(error instanceof PublicCacheError)throw error;
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

contentRoutes.delete("/api/content", bodyLimit({maxSize:4096}), async c => {
  const parsed=z.object({...version,kind:z.enum(["article","note","page"])}).safeParse(await c.req.json());
  if(!parsed.success)throw new HTTPException(400,{message:"删除参数无效"});
  const repo=repository(async()=>c.get("token"));
  await repo.remove(parsed.data.kind,parsed.data.id,parsed.data.updated_at);
  await refreshPublicSnapshot(c.env.platform?.env,repo);
  return c.json({deleted:true});
});
contentRoutes.post("/api/tags", bodyLimit({maxSize:4096}), async c => {
  const parsed=z.object({name:z.string().trim().min(1).max(80),slug:slugSchema.refine(value=>value.length<=80)}).safeParse(await c.req.json());
  if(!parsed.success)throw new HTTPException(400,{message:"标签参数无效"});
  const repo=repository(async()=>c.get("token"));
  const item=await repo.createTag(parsed.data.name,parsed.data.slug);
  await refreshPublicSnapshot(c.env.platform?.env,repo);
  return c.json({item});
});

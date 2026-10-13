import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { BlogBindings } from "./http";
import { repository } from "$lib/api";
import { publicRepository } from "$lib/public-api";
import { boundedImage, imageType } from "$lib/images";
import type { ImageRecord } from "$lib/content";
function error(status: 400 | 401 | 403 | 409 | 413 | 415 | 503, message: string): never {
  throw new HTTPException(status, { message });
}
export const imageRoutes = new Hono<{ Bindings: BlogBindings }>();
imageRoutes.post("/api/images", async (c) => {
  const request = c.req.raw;
  const platform = c.env.platform;
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) error(401, "请登录");
  const token = authorization.slice(7);
  const db = repository(async () => token).db;
  if (!platform?.env.IMAGES) error(503, "图片存储暂时不可用");
  // Authorize with an actual PostgREST write before touching R2; no duplicate JWT parser.
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await boundedImage(request);
  } catch (e) {
    error(413, e instanceof Error ? e.message : "图片无效");
  }
  const type = imageType(bytes);
  if (!type) error(415, "支持 PNG、JPEG、WebP 和 GIF 图片");
  let name: string;
  try {
    name =
      decodeURIComponent(request.headers.get("x-image-name") || "图片")
        .trim()
        .slice(0, 240) || "图片";
  } catch {
    error(400, "图片名称无效");
  }
  const sha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const { data: rows, error: insertError } = await db
    .from("image")
    .upsert(
      { name, sha256, content_type: type, size: bytes.length },
      { onConflict: "sha256", ignoreDuplicates: true },
    )
    .select("*");
  if (insertError) error(403, "无上传权限");
  let record = rows?.[0] as ImageRecord | undefined;
  if (!record) {
    const found = await db
      .from("image")
      .select("*")
      .eq("sha256", sha256)
      .single();
    if (found.error) error(409, "图片记录暂时不可用，请重试");
    record = found.data as ImageRecord;
  }
  if (!record.ready) {
    await platform.env.IMAGES.put(record.id, bytes, {
      httpMetadata: {
        contentType: type,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: { sha256 },
    });
    const updated = await db
      .from("image")
      .update({ ready: true })
      .eq("id", record.id);
    if (updated.error) error(503, "图片信息保存失败，请重试");
  }
  return c.json(
    { id: record.id, name: record.name },
    { headers: { "Cache-Control": "no-store" } },
  );
});

imageRoutes.get("/images/:id", async (c) => {
  const id = c.req.param("id");
  const request = c.req.raw;
  const platform = c.env.platform;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HTTPException(404);
  const { data, error: dbError } = await publicRepository()
    .db.from("image")
    .select("id,name,content_type,ready")
    .eq("id", id)
    .eq("ready", true)
    .maybeSingle();
  if (dbError) error(503, "图片暂时不可用");
  if (!data) throw new HTTPException(404);
  const images = platform?.env?.IMAGES;
  if (!images) error(503, "图片存储暂时不可用");
  const object = await images.get(id);
  if (!object) throw new HTTPException(404);
  const headers = new Headers({
    "Content-Type": data.content_type,
    "Cache-Control": "public,max-age=31536000,immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
    ETag: object.httpEtag,
  });
  if (request.headers.get("if-none-match") === object.httpEtag)
    return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
});

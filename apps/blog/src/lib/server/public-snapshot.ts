import type { repository } from "$lib/api";
import type { StudioContent, Translation, Tag } from "$lib/content";
import { neonPublicRepository } from "./neon-public";

export const snapshotKey = "public/v1.json";
export type PublicRow = StudioContent & {
  translation: Translation[];
  article_tag: { tag_id: string }[];
};
export type PublicSnapshot = {
  content: PublicRow[];
  tags: Tag[];
  refreshedAt: number;
};
type StoredSnapshot = Partial<PublicSnapshot> & {
  schedule: string[];
  revision: string;
  invalid?: boolean;
};
type Bucket = App.Platform["env"]["BLOG_PUBLIC"];
const maxAge = 24 * 60 * 60 * 1000;
export class PublicCacheError extends Error {
  constructor() {
    super("内容已保存，公开缓存更新失败，请重新读取当前版本");
  }
}
export async function originSnapshot(): Promise<PublicSnapshot> {
  const { db } = neonPublicRepository();
  const refreshedAt = Date.now();
  const content: PublicRow[] = [];
  // Explicit ranges avoid Data API's row cap. Relations stay with their parent row.
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db
      .from("content")
      .select(
        "id,kind,source_locale,sequence,slug,legacy_path,cover_id,status,published_at,created_at,updated_at,translation(content_id,locale,title,excerpt,markdown,is_complete,updated_at),article_tag(tag_id)",
      )
      .eq("status", "published")
      .lte("published_at", new Date(refreshedAt).toISOString())
      .order("id")
      .range(offset, offset + 99);
    if (error) throw new Error("公开内容暂时不可用");
    const rows = data as PublicRow[];
    content.push(
      ...rows.filter(
        (row) =>
          row.status === "published" &&
          row.published_at &&
          Date.parse(row.published_at) <= refreshedAt,
      ),
    );
    if (rows.length < 100) break;
  }
  const tags: Tag[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db
      .from("tag")
      .select("id,slug,translations")
      .order("id")
      .range(offset, offset + 99);
    if (error) throw new Error("公开标签暂时不可用");
    tags.push(...(data as Tag[]));
    if (data.length < 100) break;
  }
  return { content, tags, refreshedAt };
}
async function stored(bucket: Bucket) {
  const object = await bucket.get(snapshotKey);
  const value: StoredSnapshot | undefined = object
    ? await object.json<StoredSnapshot>()
    : undefined;
  return { object, value };
}
async function rebuild(bucket: Bucket, times: string[] = []) {
  for (let attempt = 0; attempt < 4; attempt++) {
    // Read version BEFORE origin. Concurrent invalidation prevents an old rebuild winning.
    const { object, value } = await stored(bucket);
    const snapshot = await originSnapshot();
    const schedule = [...new Set([...times, ...(value?.schedule ?? [])])]
      .filter((time) => Date.parse(time) > snapshot.refreshedAt)
      .sort();
    const saved = await bucket.put(
      snapshotKey,
      JSON.stringify({ ...snapshot, schedule, revision: crypto.randomUUID() }),
      {
        onlyIf: object
          ? { etagMatches: object.etag }
          : { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/json" },
      },
    );
    if (saved) return snapshot;
  }
  throw new Error("公开缓存正在更新，请重试");
}
export async function publicSnapshot(
  env?: App.Platform["env"],
): Promise<PublicSnapshot> {
  const bucket = env?.BLOG_PUBLIC;
  if (!bucket) {
    if (env) throw new Error("公开缓存未配置");
    return originSnapshot(); // Unit tests and Vite fixtures have no Cloudflare platform.
  }
  const { value } = await stored(bucket);
  if (
    value &&
    !value.invalid &&
    value.content &&
    value.tags &&
    value.refreshedAt &&
    Date.now() < value.refreshedAt + maxAge &&
    !value.schedule.some((time) => Date.parse(time) <= Date.now())
  ) {
    return {
      content: value.content,
      tags: value.tags,
      refreshedAt: value.refreshedAt,
    };
  }
  return rebuild(bucket, value?.schedule);
}
export async function refreshPublicSnapshot(
  env: App.Platform["env"] | undefined,
  repo: ReturnType<typeof repository>,
  publishedAt?: string | null,
) {
  const bucket = env?.BLOG_PUBLIC;
  if (!bucket) {
    if (env) throw new PublicCacheError();
    return;
  }
  try {
    let times: string[] = [];
    let invalidated = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { object, value } = await stored(bucket);
      times = [
        ...new Set([
          ...(value?.schedule ?? []),
          ...(publishedAt ? [publishedAt] : []),
        ]),
      ];
      const marker = await bucket.put(
        snapshotKey,
        JSON.stringify({
          invalid: true,
          revision: crypto.randomUUID(),
          schedule: times,
        }),
        {
          onlyIf: object
            ? { etagMatches: object.etag }
            : { etagDoesNotMatch: "*" },
        },
      );
      if (marker) {
        invalidated = true;
        break;
      }
    }
    if (!invalidated) throw new Error("Concurrent update");
    // Future content bodies never enter the snapshot. Only publication times are retained.
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await repo.db
        .from("content")
        .select("published_at")
        .eq("status", "published")
        .gt("published_at", new Date().toISOString())
        .order("published_at")
        .order("id")
        .range(offset, offset + 99);
      if (error) throw error;
      times.push(
        ...data.map((row: { published_at: string }) => row.published_at),
      );
      if (data.length < 100) break;
    }
    await rebuild(bucket, times);
  } catch {
    throw new PublicCacheError();
  }
}

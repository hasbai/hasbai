import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { repository } from "$lib/api";
import { blogHttp } from "./http";
import {
  publicSnapshot,
  refreshPublicSnapshot,
  snapshotKey,
} from "./public-snapshot";
import { snapshotRepository } from "./public-reader";
import { publicSearch } from "./public-search";

const id = "20000000-0000-4000-8000-000000000001";
function row(n = 1) {
  return {
    id: id.slice(0, -1) + n,
    kind: "article",
    slug: "hello-" + n,
    sequence: n,
    source_locale: "zh-CN",
    status: "published",
    published_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
    article_tag: [],
    translation: [
      {
        locale: "zh-CN",
        title: "标题" + n,
        excerpt: "摘要",
        markdown: "正文\nsecond line",
      },
    ],
  };
}
let rows: ReturnType<typeof row>[];
let unavailable = false;
let scheduled: string[] = [];
let originCalls = 0;
beforeEach(() => {
  rows = [row()];
  unavailable = false;
  scheduled = [];
  originCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/token/anonymous"))
        return Response.json({ token: "guest" });
      originCalls++;
      if (unavailable)
        return Response.json({ message: "unavailable" }, { status: 503 });
      if (url.pathname.endsWith("/tag")) return Response.json([]);
      if (
        url.searchParams.has("published_at") &&
        url.searchParams.get("published_at")!.startsWith("gt.")
      )
        return Response.json(
          scheduled.map((published_at) => ({ published_at })),
        );
      const offset = Number(url.searchParams.get("offset") ?? 0),
        limit = Number(url.searchParams.get("limit") ?? 100);
      return Response.json(
        rows
          .filter(
            (r) =>
              r.status === "published" &&
              Date.parse(r.published_at) <= Date.now(),
          )
          .slice(offset, offset + limit),
      );
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function storage() {
  let value: { body: string; etag: string } | null = null;
  let beforePut: ((body: string) => void) | undefined;
  const put = vi.fn(
    async (
      _key: string,
      body: string,
      options?: {
        onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string };
      },
    ) => {
      beforePut?.(body);
      const condition = options?.onlyIf;
      if (condition?.etagMatches && condition.etagMatches !== value?.etag)
        return null;
      if (condition?.etagDoesNotMatch === "*" && value) return null;
      value = { body, etag: createHash("sha256").update(body).digest("hex") };
      return { etag: value.etag };
    },
  );
  const get = vi.fn(async () =>
    value
      ? { etag: value.etag, json: async () => JSON.parse(value!.body) }
      : null,
  );
  const env = {
    BLOG_PUBLIC: { get, put },
    BLOG_SETTINGS: { get: async () => ["zh-CN", "en-US"] },
  } as App.Platform["env"];
  return {
    env,
    put,
    get,
    read: () => JSON.parse(value!.body),
    replace: (body: string) => {
      value = { body, etag: createHash("sha256").update(body).digest("hex") };
    },
    intercept: (callback: (body: string) => void) => {
      beforePut = callback;
    },
  };
}
it("serves unknown slugs and different public readers from one durable snapshot without origin calls", async () => {
  const { env } = storage();
  await publicSnapshot(env);
  expect(originCalls).toBe(2);
  const request = (op: string, args: unknown[]) =>
    blogHttp.request(
      "/api/public?" + new URLSearchParams({ op, args: JSON.stringify(args) }),
      {},
      { platform: { env } },
    );
  for (const slug of ["unknown-one", "another-scanner", "about"]) {
    const response = await request("pageBySlug", [slug]);
    expect(await response.json()).toEqual({ data: null });
    expect(response.headers.get("X-Blog-Source")).toBe("r2");
  }
  const response = await request("articles", [{ limit: 6 }]);
  expect((await response.json()).data).toHaveLength(1);
  expect(originCalls).toBe(2);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
it("paginates the origin snapshot and keeps draft/future bodies out of it", async () => {
  const { env } = storage();
  rows = Array.from({ length: 205 }, (_, n) => row(n + 1));
  rows.push(
    { ...row(300), status: "draft" },
    { ...row(301), published_at: "2999-01-01T00:00:00Z" },
  );
  const snapshot = await publicSnapshot(env);
  expect(snapshot.content).toHaveLength(205);
  expect(originCalls).toBe(4);
});
it("invalidates a withdrawal across independent readers and does not publish old content on refresh failure", async () => {
  const { env, read } = storage();
  await publicSnapshot(env);
  rows = [];
  unavailable = true;
  await expect(
    refreshPublicSnapshot(
      env,
      repository(async () => "admin"),
    ),
  ).rejects.toThrow("内容已保存");
  expect(read().invalid).toBe(true);
  await expect(publicSnapshot(env)).rejects.toThrow();
  unavailable = false;
  expect((await publicSnapshot(env)).content).toEqual([]);
  expect(read().invalid).toBeUndefined();
});
it("re-reads origin after a concurrent invalidation instead of publishing an older snapshot", async () => {
  const state = storage();
  await publicSnapshot(state.env);
  let raced = false;
  state.intercept((body) => {
    if (!raced && !JSON.parse(body).invalid) {
      raced = true;
      rows = [];
      state.replace(
        JSON.stringify({
          invalid: true,
          revision: "another-commit",
          schedule: [],
        }),
      );
    }
  });
  await refreshPublicSnapshot(
    state.env,
    repository(async () => "admin"),
  );
  expect(state.read().content).toEqual([]);
  expect(raced).toBe(true);
  const revisions = state.put.mock.calls.map(
    (call) => JSON.parse(call[1]).revision,
  );
  expect(new Set(revisions).size).toBe(revisions.length);
});
it("records only future publication times and refreshes on the first due read without a cron", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
  const state = storage();
  scheduled = ["2026-10-20T01:00:00Z", "2026-10-20T02:00:00Z"];
  await refreshPublicSnapshot(
    state.env,
    repository(async () => "admin"),
    scheduled[0],
  );
  const before = originCalls;
  expect(state.read().schedule).toEqual(scheduled);
  await publicSnapshot(state.env);
  expect(originCalls).toBe(before);
  vi.setSystemTime(new Date(scheduled[0]));
  rows.push({ ...row(2), published_at: scheduled[0] });
  expect((await publicSnapshot(state.env)).content).toHaveLength(2);
  expect(state.read().schedule).toEqual([scheduled[1]]);
  vi.setSystemTime(new Date(scheduled[1]));
  rows.push({ ...row(3), published_at: scheduled[1] });
  expect((await publicSnapshot(state.env)).content).toHaveLength(3);
});
it("invalidates immediately after the save RPC even when its detail SELECT fails", async () => {
  let committed = false,
    invalidated = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/rpc/save_content")) {
        committed = true;
        return Response.json({ id });
      }
      return Response.json({ message: "detail unavailable" }, { status: 503 });
    }),
  );
  const repo = repository(
    async () => "admin",
    undefined,
    "zh-CN",
    async () => {
      expect(committed).toBe(true);
      invalidated = true;
    },
  );
  await expect(
    repo.saveArticle({
      locale: "zh-CN",
      title: "标题",
      slug: "hello",
      excerpt: "",
      markdown: "正文",
      tag_ids: [],
      cover_id: null,
      status: "draft",
      published_at: null,
    }),
  ).rejects.toThrow("detail unavailable");
  expect(invalidated).toBe(true);
});
it("rejects private read options and fails closed if a deployed platform lacks its bucket", async () => {
  const { env } = storage();
  const response = await blogHttp.request(
    "/api/public?op=articles&args=" +
      encodeURIComponent(JSON.stringify([{ studio: true }])),
    {},
    { platform: { env } },
  );
  expect(response.status).toBe(400);
  expect(originCalls).toBe(0);
  await expect(publicSnapshot({} as App.Platform["env"])).rejects.toThrow(
    "未配置",
  );
});
it("preserves localized summaries, pagination, safe missing content and wildcard search", async () => {
  const { env } = storage();
  rows = Array.from({ length: 5 }, (_, n) => row(n + 1));
  const repo = snapshotRepository(await publicSnapshot(env), "en-US");
  expect(await repo.articles({ page: 2, limit: 2 })).toHaveLength(3);
  expect((await repo.articles())[0]).toMatchObject({
    locale: "zh-CN",
    markdown: "",
  });
  expect(await repo.pageBySlug("unknown")).toBeNull();
  expect(await repo.search("article", "正文%line", 1, 2)).toHaveLength(3);
  expect(publicSearch("正文\nsecond line", "正_*line")).toBe(true);
  expect(publicSearch("a".repeat(10000), "%a".repeat(30) + "%b")).toBe(false);
  expect(publicSearch("public text", "x,status.eq.draft")).toBe(false);
});

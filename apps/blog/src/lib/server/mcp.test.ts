import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { blogHttp } from "./http";

const id = "c51f7180-6795-4a3a-8ec6-060ebc3fe98b";
const requests: { url: URL; authorization: string | null }[] = [];
let rows: Record<string, unknown>[] = [];
let unavailable = false;
beforeEach(() => {
  requests.length = 0;
  rows = [];
  unavailable = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith("/token/anonymous"))
      return Response.json({ token: "guest-jwt" });
    requests.push({ url, authorization: request.headers.get("authorization") });
    if (unavailable) return Response.json({ message: "private upstream diagnostic" }, { status: 503 });
    const published = rows.filter(row => row.status === "published" &&
      typeof row.published_at === "string" && new Date(row.published_at) <= new Date());
    return Response.json(url.searchParams.has("id") ? published.slice(0, 1) : published);
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function rpc(method: string, params?: object, authorization?: string) {
  return blogHttp.request("https://hasbai.xyz/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }, {});
}
const call = (name: string, args: object, authorization?: string) =>
  rpc("tools/call", { name, arguments: args }, authorization).then(r => r.json());

it("discovers a stable tool catalog for the Portal without opening the database", async () => {
  const initialized = await (await rpc("initialize", {
    protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" },
  })).json();
  expect(initialized.result.serverInfo.name).toBe("北极小站");
  const listed = await (await rpc("tools/list")).json();
  expect(listed.result.tools.map((t: { name: string }) => t.name))
    .toEqual(["list_content", "get_content", "list_tags", "create_content", "update_content", "delete_content", "create_tag", "update_tag", "delete_tag"]);
  expect(listed.result.tools.slice(0, 3).every((t: { annotations: { readOnlyHint: boolean } }) => t.annotations.readOnlyHint)).toBe(true);
  expect(requests).toEqual([]);
});

it.each(["article", "note", "page"])("limits %s lists, omits body and uses anonymous credentials", async (kind) => {
  rows = Array.from({ length: 3 }, (_, n) => ({ id, kind, title: "公开", slug: "about", sequence: n + 1,
    status: "published", published_at: "2020-01-01T00:00:00Z", excerpt: "摘要" }));
  const body = await call("list_content", { kind, limit: 2, page: 2 });
  expect(body.result.structuredContent.items).toHaveLength(2);
  expect(body.result.structuredContent.has_more).toBe(true);
  expect(body.result.structuredContent.items[0].url).toMatch(/^https:\/\/hasbai.xyz\//);
  const sent = requests[0];
  expect(sent.authorization).toBe("Bearer guest-jwt");
  expect(sent.url.pathname).toContain(kind);
  expect(sent.url.searchParams.get("status")).toBe("eq.published");
  expect(sent.url.searchParams.get("published_at")).toMatch(/^lte\./);
  expect(sent.url.searchParams.get("select")).not.toContain("markdown");
  expect(sent.url.searchParams.get("offset")).toBe("2");
  expect(sent.url.searchParams.get("limit")).toBe("3");
});

it.each(["draft", "future"])("anonymous callers cannot read %s content", async (state) => {
  rows = [{ id, kind: "article", slug: "hidden", markdown: "隐藏正文", status: state === "draft" ? "draft" : "published",
    published_at: state === "future" ? "2999-01-01T00:00:00Z" : "2020-01-01T00:00:00Z" }];
  const body = await call("get_content", { kind: "article", id });
  expect(body.result.structuredContent.item).toBeNull();
  expect(requests[0].authorization).toBe("Bearer guest-jwt");
  expect(requests[0].url.searchParams.get("status")).toBe("eq.published");
  expect(requests[0].url.searchParams.get("published_at")).toMatch(/^lte\./);
});

it("returns Markdown only for a published detail and supports tag discovery", async () => {
  rows = [{ id, kind: "page", title: "关于", slug: "about", markdown: "# 公开正文", status: "published",
    published_at: "2020-01-01T00:00:00Z" }];
  const body = await call("get_content", { kind: "page", id });
  expect(body.result.structuredContent.item).toMatchObject({ markdown: "# 公开正文", url: "https://hasbai.xyz/about" });
  expect(requests[0].url.searchParams.get("select")).toContain("markdown");
  await call("list_tags", {});
  expect(requests[1].url.pathname).toContain("tag");
});

it("quotes search input rather than allowing PostgREST filter injection", async () => {
  const query = 'x\t\\",status.eq.draft';
  await call("list_content", { query });
  expect(requests[0].url.searchParams.get("or"))
    .toBe('(title.ilike."%x\t\\\\\\",status.eq.draft%",excerpt.ilike."%x\t\\\\\\",status.eq.draft%",markdown.ilike."%x\t\\\\\\",status.eq.draft%")');
  expect(requests[0].url.searchParams.get("status")).toBe("eq.published");
});

it("retains documented wildcard semantics", async () => {
  await call("list_content", { query: "%_*" });
  expect(requests[0].url.searchParams.get("or"))
    .toBe('(title.ilike."%%_*%",excerpt.ilike."%%_*%",markdown.ilike."%%_*%")');
});
it.each([{ limit: 51 }, { page: 0 }, { kind: "image" }, { query: " " }, { query: "a\nb" }, { query: "a\rb" }])("rejects invalid list arguments %j", async (args) => {
  const body = await call("list_content", args);
  expect(body.result.isError).toBe(true);
  expect(requests).toEqual([]);
});

it("rejects invalid IDs, unknown tools and oversized bodies", async () => {
  expect((await call("get_content", { kind: "article", id: "../private" })).result.isError).toBe(true);
  expect((await call("publish_content", {})).result.isError).toBe(true);
  expect((await blogHttp.request("/api/mcp", { method: "POST", body: "x".repeat(8 * 1024 * 1024 + 1) }, {})).status).toBe(413);
  expect(requests).toEqual([]);
});

it("supports stateless notifications, rejects session streams and returns public errors", async () => {
  const notification = await blogHttp.request("/api/mcp", { method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }, {});
  expect(notification.status).toBe(202);
  for (const method of ["GET", "DELETE"])
    expect((await blogHttp.request("/api/mcp", { method, headers: { Accept: "text/event-stream" } }, {})).status).toBe(405);
  unavailable = true;
  const body = await call("list_content", {});
  expect(body.result.isError).toBe(true);
  expect(JSON.stringify(body)).not.toContain("private upstream diagnostic");
});

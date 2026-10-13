import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { blogHttp } from "./http";

const id = "c51f7180-6795-4a3a-8ec6-060ebc3fe98b";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
let authorized = true;
let ready = true;
const put = vi.fn();
const get = vi.fn();
const platform = { env: { IMAGES: { put, get },
  VERSION: { id: "test-version", tag: "test", timestamp: "2026-10-13T00:00:00Z" } } } as App.Platform;
const databaseCalls: string[] = [];
beforeEach(() => {
  authorized = true; ready = true;
  databaseCalls.length = 0;
  put.mockReset();
  get.mockReset().mockImplementation(async () => ({ body: new Blob([png]).stream(), httpEtag: '"etag"' }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url.endsWith("/token/anonymous")) return Response.json({ token: "guest" });
    databaseCalls.push(request.method);
    if (!authorized) return Response.json({ message: "denied" }, { status: 403 });
    if (request.method === "PATCH") return new Response(null, { status: 204 });
    return Response.json([{ id, ready, name: "图片", content_type: "image/png" }]);
  }));
});
afterEach(() => vi.unstubAllGlobals());
function upload(body: BodyInit = png, headers: Record<string, string> = { Authorization: "Bearer user" }) {
  return blogHttp.request("/api/images", { method: "POST", headers, body }, { platform });
}

it("preserves version metadata and method contracts", async () => {
  const version = await blogHttp.request("/api/version", {}, { platform });
  expect(await version.json()).toEqual({ id: "test-version", tag: "test" });
  expect((await blogHttp.request("/api/version", { method: "POST" }, { platform })).status).toBe(405);
  expect((await blogHttp.request("/api/images", {}, { platform })).status).toBe(405);
});
it("refuses uploads before touching R2 when login or database authorization fails", async () => {
  expect((await upload(png, { Authorization: "" })).status).toBe(401);
  expect(databaseCalls).toEqual([]);
  authorized = false;
  expect((await upload()).status).toBe(403);
  expect(put).not.toHaveBeenCalled();
});
it("rejects unsafe content, malformed names and oversized streams", async () => {
  expect((await upload("<svg></svg>")).status).toBe(415);
  expect((await upload(png, { Authorization: "Bearer user", "X-Image-Name": "%ZZ" })).status).toBe(400);
  expect((await upload(new Uint8Array(10 * 1024 * 1024 + 1))).status).toBe(413);
  expect(put).not.toHaveBeenCalled();
  expect(databaseCalls).toEqual([]);
});
it("uploads authorized new bytes before marking metadata ready and reuses ready images", async () => {
  ready = false;
  put.mockImplementation(async () => { expect(databaseCalls).toEqual(["POST"]); });
  const response = await upload();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id, name: "图片" });
  expect(put).toHaveBeenCalledWith(id, png, expect.objectContaining({ httpMetadata: expect.objectContaining({ contentType: "image/png" }) }));
  expect(databaseCalls).toEqual(["POST", "PATCH"]);
  ready = true;
  put.mockClear();
  expect((await upload()).status).toBe(200);
  expect(put).not.toHaveBeenCalled();
});
it("streams public images with immutable caching, ETag and conditional responses", async () => {
  const response = await blogHttp.request(`/images/${id}`, {}, { platform });
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(response.headers.get("Cache-Control")).toContain("immutable");
  expect(response.headers.get("ETag")).toBe('"etag"');
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  const cached = await blogHttp.request(`/images/${id}`, { headers: { "If-None-Match": '"etag"' } }, { platform });
  expect(cached.status).toBe(304);
  expect(await cached.text()).toBe("");
  expect((await blogHttp.request("/images/invalid", {}, { platform })).status).toBe(404);
});

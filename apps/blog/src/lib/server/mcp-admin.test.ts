import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { blogHttp } from "./http";

const id = "c51f7180-6795-4a3a-8ec6-060ebc3fe98b";
const tagId = "b51f7180-6795-4a3a-8ec6-060ebc3fe98b";
const updatedAt = "2026-10-12T00:00:00Z";
let key: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: Awaited<ReturnType<typeof exportJWK>>;
let admin: string;
let ordinary: string;
let conflict = false;
const calls: {
  method: string;
  url: URL;
  body: Record<string, unknown> | null;
  authorization: string | null;
}[] = [];
beforeAll(async () => {
  key = await generateKeyPair("RS256");
  jwk = { ...(await exportJWK(key.publicKey)), kid: "admin-test" };
  admin = await sign();
  ordinary = await sign({ permissions: [], _roles: ["superadmin"] });
});
function sign(
  claims = { permissions: ["blog.all:all"] } as Record<string, unknown>,
  audience = "https://financial.hasbai.xyz/api",
  issuer = "https://auth.hasbai.xyz/",
  exp = "1h",
  sub = "auth0|admin",
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "admin-test" })
    .setSubject(sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key.privateKey);
}
beforeEach(() => {
  conflict = false;
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/jwks.json"))
        return Response.json({ keys: [jwk] });
      if (url.pathname.endsWith("/token/anonymous"))
        return Response.json({ token: "guest" });
      const body =
        request.method === "GET" || request.method === "DELETE"
          ? null
          : await request.json();
      calls.push({
        method: request.method,
        url,
        body,
        authorization: request.headers.get("authorization"),
      });
      if (conflict && request.method !== "GET")
        return url.pathname.includes("save_content")
          ? Response.json({ message: "conflict" }, { status: 409 })
          : Response.json([]);
      if (url.pathname.endsWith("/article_tag"))
        return Response.json([{ tag_id: tagId }]);
      if (url.pathname.endsWith("/tag"))
        return Response.json([{ id: tagId, name: "原标签", slug: "tag" }]);
      const kind = String(
        body?.p_kind ??
          url.searchParams.get("kind")?.replace("eq.", "") ??
          "article",
      );
      const item = {
        id,
        kind,
        sequence: 1,
        slug: "draft",
        title: "草稿",
        excerpt: "摘要",
        markdown: "正文",
        cover_id: null,
        status: "draft",
        published_at: null,
        updated_at: updatedAt,
      };
      const stored = {
          ...item,
          article_tag:kind==="article"?[{tag_id:tagId}]:[],
          translation: [
            {
              content_id: id,
              locale: "zh-CN",
              title: item.title,
              excerpt: item.excerpt,
              markdown: item.markdown,
              updated_at: updatedAt,
            },
          ],
        };
      return Response.json(request.headers.get("Accept")?.includes("vnd.pgrst.object") ? stored : [stored]);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
async function rpc(method: string, params: object, token?: string) {
  return blogHttp.request(
    "https://hasbai.xyz/api/mcp",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
    {},
  );
}
const call = (name: string, args: object, token = admin) =>
  rpc("tools/call", { name, arguments: args }, token).then((r) => r.json());
const value = {
  excerpt: "摘要",
  markdown: "正文",
  cover_id: null,
  status: "draft",
  published_at: null,
};
const content = (kind: string) => ({
  kind,
  value: {
    ...value,
    ...(kind === "note" ? {} : { title: "标题", slug: "draft" }),
    ...(kind === "article" ? { tag_ids: [tagId] } : {}),
  },
});

it("verifies signed administrator permissions and keeps ordinary users read-only", async () => {
  const listed = await (await rpc("tools/list", {}, admin)).json();
  expect(listed.result.tools.map((t: { name: string }) => t.name)).toEqual([
    "list_content",
    "get_content",
    "list_tags",
    "create_content",
    "update_content",
    "delete_content",
    "create_tag",
    "update_tag",
    "delete_tag",
  ]);
  const ordinaryList = await (await rpc("tools/list", {}, ordinary)).json();
  expect(ordinaryList.result.tools).toEqual(listed.result.tools);
  expect(
    (
      await call(
        "delete_content",
        { kind: "note", id, updated_at: updatedAt },
        ordinary,
      )
    ).result.isError,
  ).toBe(true);
  expect(
    (await call("create_content", { content: content("note") }, "")).result
      .isError,
  ).toBe(true);
  expect(calls).toEqual([]);
});
it("rejects every management operation for ordinary, anonymous and legacy-permission callers", async () => {
  const legacy = await sign({
    permissions: ["manage:blog"],
    _roles: ["superadmin"],
  });
  const operations: [string, object][] = [
    ["create_content", { content: content("note") }],
    ["update_content", { content: content("note"), id, updated_at: updatedAt }],
    ["delete_content", { kind: "note", id, updated_at: updatedAt }],
    ["create_tag", { name: "标签", slug: "tag" }],
    ["update_tag", { id: tagId, name: "标签", slug: "tag" }],
    ["delete_tag", { id: tagId }],
  ];
  for (const token of [ordinary, legacy, ""])
    for (const [name, args] of operations) {
      const response = await call(name, args, token);
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].text).toBe("需要 blog.all:all 权限");
    }
  expect(calls).toEqual([]);
});
it("rejects malformed, forged, expired, wrong-issuer/audience and machine tokens", async () => {
  const tokens = [
    "invalid",
    await sign(undefined, "wrong"),
    await sign(undefined, undefined, "https://wrong.test/"),
    await sign(undefined, undefined, undefined, "-1h"),
    await sign(undefined, undefined, undefined, undefined, "app@clients"),
  ];
  const other = await generateKeyPair("RS256");
  tokens.push(
    await new SignJWT({ permissions: ["blog.all:all"] })
      .setProtectedHeader({ alg: "RS256", kid: "admin-test" })
      .setSubject("auth0|forged")
      .setIssuer("https://auth.hasbai.xyz/")
      .setAudience("https://financial.hasbai.xyz/api")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(other.privateKey),
  );
  for (const token of tokens)
    expect((await rpc("tools/list", {}, token)).status).toBe(401);
  expect(calls).toEqual([]);
});
it("reads administrator drafts with all editing fields and preserves article tag IDs", async () => {
  const body = await call("get_content", { kind: "article", id });
  expect(body.result.structuredContent.item).toMatchObject({
    markdown: "正文",
    status: "draft",
    cover_id: null,
    published_at: null,
    updated_at: updatedAt,
    tag_ids: [tagId],
  });
  expect(calls[0].url.searchParams.has("status")).toBe(false);
  expect(calls[0].url.searchParams.has("published_at")).toBe(false);
  expect(calls.every((c) => c.authorization === `Bearer ${admin}`)).toBe(true);
  await call("list_content", { kind: "note" });
  expect(calls.at(-1)?.url.searchParams.has("status")).toBe(false);
});
it.each(["article", "note", "page"])(
  "creates, updates and deletes %s with existing version contracts",
  async (kind) => {
    expect(
      (await call("create_content", { content: content(kind) })).result.isError,
    ).toBeUndefined();
    const create = calls[0];
    expect(create.method).toBe("POST");
    expect(create.authorization).toBe(`Bearer ${admin}`);
    expect(create.body).toMatchObject({
      p_kind: kind,
      p_updated_at: null,
      p_locale: "zh-CN",
      p_value: value,
    });
    if (kind === "article")
      expect(create.body?.p_value).toMatchObject({ tag_ids: [tagId] });
    expect(
      (
        await call("update_content", {
          content: content(kind),
          id,
          updated_at: updatedAt,
        })
      ).result.isError,
    ).toBeUndefined();
    const update = calls.find((c) => c.body?.p_updated_at === updatedAt)!;
    expect(update.body).toMatchObject({
      p_id: id,
      p_kind: kind,
      p_updated_at: updatedAt,
    });
    expect(
      (await call("delete_content", { kind, id, updated_at: updatedAt })).result
        .structuredContent.deleted,
    ).toBe(true);
    expect(calls.at(-1)?.method).toBe("DELETE");
    expect(calls.at(-1)!.url.searchParams.get("updated_at")).toBe(
      `eq.${updatedAt}`,
    );
  },
);
it.each(["article", "note", "page"])(
  "reports stale %s update and delete without claiming success",
  async (kind) => {
    conflict = true;
    expect(
      (
        await call("update_content", {
          content: content(kind),
          id,
          updated_at: updatedAt,
        })
      ).result.isError,
    ).toBe(true);
    expect(
      (await call("delete_content", { kind, id, updated_at: updatedAt })).result
        .isError,
    ).toBe(true);
  },
);
it("validates publication, reserved page paths and required versions before writing", async () => {
  for (const args of [
    {
      content: {
        kind: "note",
        value: { ...value, markdown: "", status: "published" },
      },
    },
    {
      content: {
        kind: "page",
        value: { ...value, title: "标题", slug: "api" },
      },
    },
  ])
    expect((await call("create_content", args)).result.isError).toBe(true);
  expect(
    (await call("update_content", { content: content("note"), id })).result
      .isError,
  ).toBe(true);
  expect(
    (await call("delete_content", { kind: "note", id })).result.isError,
  ).toBe(true);
  expect(calls).toEqual([]);
});
it("accepts existing-length Chinese Markdown beyond the old 64 KiB limit", async () => {
  const large = {
    kind: "note",
    value: { ...value, markdown: "中文正文".repeat(30000) },
  };
  expect(
    (await call("create_content", { content: large })).result.isError,
  ).toBeUndefined();
  expect((calls[0].body?.p_value as Record<string, unknown>)?.markdown).toBe(
    large.value.markdown,
  );
});
it("uses administrator credentials for tag CRUD without automatically unlinking articles", async () => {
  expect(
    (await call("create_tag", { name: "新标签", slug: "new" })).result.isError,
  ).toBeUndefined();
  expect(
    (await call("update_tag", { id: tagId, name: "修改", slug: "changed" }))
      .result.isError,
  ).toBeUndefined();
  expect(
    (await call("delete_tag", { id: tagId })).result.structuredContent.deleted,
  ).toBe(true);
  expect(calls.map((c) => c.method)).toEqual([
    "POST",
    "GET",
    "PATCH",
    "DELETE",
  ]);
  expect(calls.every((c) => c.url.pathname.endsWith("/tag"))).toBe(true);
  expect(
    (await call("create_tag", { name: "标签", slug: "a".repeat(81) })).result
      .isError,
  ).toBe(true);
});

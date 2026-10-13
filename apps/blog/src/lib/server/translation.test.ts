import { afterEach, expect, it, vi } from "vitest";
import { repository } from "$lib/api";
import { translate, translateContent } from "./translation";
import type { Translation } from "$lib/content";
const source: Translation = {
  content_id: "00000000-0000-4000-8000-000000000001",
  locale: "zh-CN",
  title: "标题",
  excerpt: "摘要",
  markdown: "# 原文\n\n[链接](/about)",
  updated_at: "2026-10-13T00:00:00Z",
};
const env = { AIG_TRANSLATE_RUN_TOKEN: "test" } as App.Platform["env"];
const text = {
  title: "Title",
  excerpt: "Summary",
  markdown: "# Text\n\n[Link](/about)",
};
afterEach(() => vi.unstubAllGlobals());
it("uses the deployed custom provider translation route with JSON output", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(text) } },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(await translate(env, source, "en-US")).toEqual(text);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain("/custom/compat/chat/completions");
  expect(JSON.parse(String(init.body))).toMatchObject({
    model: "dynamic/translate",
    stream: false,
    response_format: { type: "json_object" },
  });
});
it.each([
  { finish_reason: "length", message: { content: JSON.stringify(text) } },
  { finish_reason: "stop", message: { content: "not json" } },
  {
    finish_reason: "stop",
    message: { content: JSON.stringify({ ...text, markdown: "" }) },
  },
])("rejects truncated, invalid or empty AI translations", async (choice) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ choices: [choice] })),
  );
  await expect(translate(env, source, "en-US")).rejects.toThrow();
});
it("automatic translation skips existing languages and reports failed targets without replacing them", async () => {
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/translation"))
        return Response.json([source, { ...source, locale: "en-US" }]);
      if (url.includes("gateway.ai"))
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(text) },
            },
          ],
        });
      calls.push(JSON.parse(String(init?.body)));
      return Response.json(null);
    }),
  );
  expect(
    await translateContent(
      repository(async () => "test"),
      env,
      source.content_id,
      "zh-CN",
      ["zh-CN", "en-US", "zh-TW"],
      true,
    ),
  ).toEqual([]);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    p_locale: "zh-TW",
    p_missing_only: true,
    p_source_updated_at: source.updated_at,
  });
});
it("manual overwrite carries source and target versions and surfaces a conflict", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/translation"))
        return Response.json([source, { ...source, locale: "en-US" }]);
      if (url.includes("gateway.ai"))
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(text) },
            },
          ],
        });
      return Response.json({ message: "译文已更新" }, { status: 409 });
    }),
  );
  await expect(
    translateContent(
      repository(async () => "test"),
      env,
      source.content_id,
      "zh-CN",
      ["en-US"],
      false,
    ),
  ).rejects.toThrow("译文已更新");
});

it('completes an existing empty translation instead of treating it as finished',async()=>{
 let target='';vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);if(url.includes('/translation'))return Response.json([source,{...source,locale:'en-US',markdown:'',is_complete:false}]);
  if(url.includes('gateway.ai'))return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(text)}}]});
  target=JSON.parse(String(init?.body)).p_locale;return Response.json(null);
 }));expect(await translateContent(repository(async()=>'test'),env,source.content_id,'zh-CN',['en-US'],true)).toEqual([]);expect(target).toBe('en-US');
});

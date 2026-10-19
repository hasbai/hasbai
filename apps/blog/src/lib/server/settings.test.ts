import { expect, it } from "vitest";
import { localesResponse } from "./settings";

it("returns current public languages and preserves HEAD and unavailable responses", async () => {
  const env = { BLOG_SETTINGS: { get: async () => ["zh-CN", "fr-FR"] } } as unknown as App.Platform["env"];
  expect(await (await localesResponse(env)).json()).toEqual({ locales: ["zh-CN", "fr-FR"], available: ["zh-CN", "zh-TW", "en-US", "fr-FR"] });
  const head = await localesResponse(env, "HEAD");
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  const unavailable = await localesResponse({ BLOG_SETTINGS: { get: async () => { throw new Error("unavailable"); } } } as unknown as App.Platform["env"]);
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toEqual({ message: "服务暂时不可用" });
});

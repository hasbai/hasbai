import { expect, it } from "vitest";
import { translateUI } from "./i18n";

it("localizes partial translation warnings without losing pending languages", () => {
  const warning = "原文已保存，以下语言待翻译：zh-TW, en-US";
  expect(translateUI("en-US", warning)).toBe("Original saved. Translation pending: zh-TW, en-US");
  expect(translateUI("zh-TW", warning)).toBe("原文已儲存，以下語言待翻譯：zh-TW, en-US");
  expect(translateUI("zh-CN", warning)).toBe(warning);
});

it("preserves source text and interpolation in the default language", () => {
  expect(translateUI("zh-CN", "首页")).toBe("首页");
  expect(translateUI("zh-CN", "{{kind}}不存在或无操作权限", { kind: "页面" })).toBe("页面不存在或无操作权限");
  expect(translateUI("en-US", "首页")).toBe("Home");
  expect(translateUI("zh-TW", "首页")).toBe("首頁");
});

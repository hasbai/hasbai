import { expect, it } from "vitest";
import { localize } from "./api";
import {
  localeFromPath,
  localizedPath,
  normalizeLocale,
  withoutLocale,
} from "./locales";
import { translateUI } from "./i18n";
import type { Article, Translation } from "./content";
it("resolves locale aliases and preserves default and service URLs", () => {
  expect(normalizeLocale("en")).toBe("en-US");
  expect(normalizeLocale("ZH-tw")).toBe("zh-TW");
  expect(localeFromPath("/en/articles/hello")).toBe("en-US");
  expect(localeFromPath("/about")).toBe("zh-CN");
  expect(withoutLocale("/en-US/studio")).toBe("/studio");
  expect(withoutLocale("/new")).toBe("/new");
  expect(withoutLocale("/my-page")).toBe("/my-page");
  expect(withoutLocale("/foo-bar")).toBe("/foo-bar");
  expect(withoutLocale("/fr/articles", ["zh-CN", "fr-FR"])).toBe("/articles");
  expect(localizedPath("/en/articles/a?x=1", "zh-TW")).toBe(
    "/zh-TW/articles/a?x=1",
  );
  expect(localizedPath("/zh-TW/articles/a")).toBe("/articles/a");
  for (const url of [
    "/api/images",
    "/images/id",
    "/auth/callback",
    "https://example.com",
    "//example.com",
  ])
    expect(localizedPath(url, "en-US")).toBe(url);
});
it("keeps UI language isolated across concurrent SSR requests", () => {
  expect(translateUI("en-US", "文章")).toBe("Articles");
  expect(translateUI("zh-TW", "手记")).toBe("手記");
  expect(translateUI("zh-CN", "手记")).toBe("手记");
  expect(translateUI("en-US", "手记")).toBe("Notes");
});
it("selects a requested translation and reports the actual fallback language", () => {
  const row = {
    id: "x",
    source_locale: "en-US",
    translation: [
      { locale: "zh-CN", title: "原文" },
      { locale: "en-US", title: "English" },
    ],
  } as Article & { translation: Translation[] };
  expect(localize(row, "en-US")).toMatchObject({
    title: "English",
    locale: "en-US",
  });
  expect(localize(row, "zh-TW")).toMatchObject({
    title: "原文",
    locale: "zh-CN",
  });
  expect(
    localize({ ...row, translation: row.translation.slice(1) }, "zh-TW"),
  ).toMatchObject({ title: "English", locale: "en-US" });
});

it('falls back from an existing incomplete translation on public content',()=>{
 const row={id:'x',status:'published',source_locale:'zh-CN',translation:[{locale:'zh-CN',title:'原文',is_complete:true},{locale:'en-US',title:'Empty',is_complete:false}]} as Article & {translation:Translation[]};
 expect(localize(row,'en-US')).toMatchObject({title:'原文',locale:'zh-CN'});
});

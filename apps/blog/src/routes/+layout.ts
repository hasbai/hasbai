import { error } from "@sveltejs/kit";
import { resolveLocale, localeSegment } from "$lib/locales";
import type { LayoutLoad } from "./$types";
export const load: LayoutLoad = async ({ url, fetch }) => {
  const response = await fetch("/api/locales");
  if (!response.ok) error(503, "语言配置暂时不可用");
  const { locales, available } = (await response.json()) as {
    locales: string[];
    available: string[];
  };
  const candidate = resolveLocale(localeSegment(url.pathname), available);
  const locale = available.includes(candidate) ? candidate : "zh-CN";
  if (!locales.includes(locale)) error(404, "语言未启用");
  return { locale, locales, available };
};

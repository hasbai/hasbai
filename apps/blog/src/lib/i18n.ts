import { createInstance, type TOptions } from "i18next";
import { getContext } from "svelte";
import messages from "./messages.json";
const instance = createInstance();
void instance.init({
  resources: {
    "zh-TW": { translation: messages.traditional },
    "en-US": { translation: messages.english },
  },
  fallbackLng: "zh-CN",
  initAsync: false,
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
});
export function translateUI(locale: string, text: string, options?: TOptions) {
  const warningPrefix = "原文已保存，以下语言待翻译：";
  if (text.startsWith(warningPrefix))
    return instance.t(warningPrefix + "{{languages}}", {
      ...options, lng: locale, defaultValue: warningPrefix + "{{languages}}",
      languages: text.slice(warningPrefix.length),
    });
  return instance.t(text, { ...options, lng: locale, defaultValue: text });
}
export function ui() {
  const locale = getContext<() => string>("blog-locale") ?? (() => "zh-CN");
  return (text: string, options?: TOptions) =>
    translateUI(locale(), text, options);
}
export function links() {
  const locale = getContext<() => string>("blog-locale") ?? (() => "zh-CN");
  const available = getContext<() => string[]>("blog-languages");
  return (path: string) => localizedPath(path, locale(), available?.());
}
import { localizedPath } from "./locales";

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(locale: string) {
  let formatter = dateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric",
    });
    // Locale settings may change. Keep only a bounded set of pure formatters.
    if (dateFormatters.size >= 16) dateFormatters.clear();
    dateFormatters.set(locale, formatter);
  }
  return formatter;
}
export function dates() {
  const locale = getContext<() => string>("blog-locale") ?? (() => "zh-CN");
  return (value: string | null) =>
    value
      ? dateFormatter(locale()).format(new Date(value))
      : translateUI(locale(), "草稿");
}

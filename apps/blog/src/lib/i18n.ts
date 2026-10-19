import { createInstance, type TOptions } from "i18next";
import { getContext } from "svelte";
import messages from "./messages.json";
let instance: ReturnType<typeof createInstance> | undefined;
function translations() {
  if (instance) return instance;
  instance = createInstance();
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
  return instance;
}
export function translateUI(locale: string, text: string, options?: TOptions) {
  if (locale === "zh-CN" && options === undefined) return text;
  const instance = translations();
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

import { formatDate } from "./dates";
export function dates() {
  const locale = getContext<() => string>("blog-locale") ?? (() => "zh-CN");
  return (value: string | null) =>
    value
      ? formatDate(value, locale())
      : translateUI(locale(), "草稿");
}

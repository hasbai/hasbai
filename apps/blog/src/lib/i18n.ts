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

export function dates() {
  const locale = getContext<() => string>("blog-locale") ?? (() => "zh-CN");
  return (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(locale(), {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "long",
          day: "numeric",
        }).format(new Date(value))
      : translateUI(locale(), "草稿");
}

export const defaultLocale = "zh-CN";
export const defaultLocales = ["zh-CN", "zh-TW", "en-US"];
const canonicalLocales = new Map<string, string>();
export function normalizeLocale(value?: string) {
  if (!value) return defaultLocale;
  // Internal links repeatedly pass these canonical values during SSR.
  if (defaultLocales.includes(value)) return value;
  const aliases: Record<string, string> = {
    zh: "zh-CN",
    en: "en-US",
    "zh-hant": "zh-TW",
    "zh-hans": "zh-CN",
    "zh-hk": "zh-TW",
  };
  if (aliases[value.toLowerCase()]) return aliases[value.toLowerCase()];
  const cached = canonicalLocales.get(value);
  if (cached !== undefined) return cached;
  let canonical: string;
  try {
    canonical = Intl.getCanonicalLocales(value)[0];
  } catch {
    canonical = value;
  }
  if (value.length <= 128) {
    if (canonicalLocales.size >= 128) canonicalLocales.clear();
    canonicalLocales.set(value, canonical);
  }
  return canonical;
}
export function resolveLocale(value: string, supported: string[]) {
  const canonical = normalizeLocale(value);
  return (
    supported.find((locale) => locale === canonical) ??
    supported.find(
      (locale) => locale.split("-")[0].toLowerCase() === value.toLowerCase(),
    ) ??
    canonical
  );
}
export function localeSegment(path: string) {
  return path.split("/")[1]?.split(/[?#]/)[0] || "";
}
export function localeFromPath(path: string, available = defaultLocales) {
  const candidate = resolveLocale(localeSegment(path), available);
  return available.includes(candidate) ? candidate : defaultLocale;
}
export function withoutLocale(path: string, available = defaultLocales) {
  const first = localeSegment(path);
  if (!first || !available.includes(resolveLocale(first, available)))
    return path;
  return path.slice(first.length + 1) || "/";
}
export function localizedPath(
  path: string,
  locale = defaultLocale,
  available = defaultLocales,
) {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /^\/(api|images|auth|assets)(\/|$)/.test(path)
  )
    return path;
  const normalized = normalizeLocale(locale);
  const base = withoutLocale(path, [...available, normalized]);
  return normalized === defaultLocale
    ? base
    : `/${normalized}${base === "/" ? "" : base}`;
}
export function languageName(locale: string) {
  return (
    (
      {
        "zh-CN": "简体中文",
        "zh-TW": "繁體中文",
        "en-US": "English",
      } as Record<string, string>
    )[locale] || locale
  );
}

export const reservedPageSlugs = [
  "articles",
  "notes",
  "timeline",
  "tags",
  "contents",
  "studio",
  "auth",
  "api",
  "images",
  "assets",
  "en",
  "zh",
  "en-us",
  "zh-cn",
  "zh-tw",
];

export const slugPattern = /^[a-z0-9][a-z0-9-]{0,159}$/;
export function isPageSlug(value: string) {
  return slugPattern.test(value) && !reservedPageSlugs.includes(value);
}

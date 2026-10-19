const fixedOffsetStart = Date.UTC(1992, 0, 1);
const fixedOffsetEnd = Date.UTC(2026, 9, 20);
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
export function formatDate(value: string, locale: string) {
  const date = new Date(value);
  const time = date.getTime();
  // Verified Shanghai UTC+8 interval through 2026-10-19; other dates keep ICU rules.
  if ((locale === "zh-CN" || locale === "zh-TW") && time >= fixedOffsetStart && time < fixedOffsetEnd) {
    const local = new Date(time + 8 * 60 * 60 * 1000);
    return `${local.getUTCFullYear()}年${local.getUTCMonth() + 1}月${local.getUTCDate()}日`;
  }
  let formatter = dateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric",
    });
    if (dateFormatters.size >= 16) dateFormatters.clear();
    dateFormatters.set(locale, formatter);
  }
  return formatter.format(date);
}

import { expect, it } from "vitest";
import { formatDate } from "./dates";

it("matches Shanghai ICU dates across modern month and day boundaries", () => {
  for (const locale of ["zh-CN", "zh-TW"]) {
    const expected = new Intl.DateTimeFormat(locale, { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric" });
    for (let year = 1992; year < 2026; year++) {
      for (let month = 0; month < 12; month++) {
        for (const hour of [15, 16]) {
          const date = new Date(Date.UTC(year, month, 1, hour));
          expect(formatDate(date.toISOString(), locale)).toBe(expected.format(date));
        }
      }
    }
  }
});
it("keeps ICU rules for historical DST, future dates, other locales and invalid dates", () => {
  for (const locale of ["zh-CN", "zh-TW", "en-US"]) {
    const expected = new Intl.DateTimeFormat(locale, { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric" });
    for (const value of ["1991-07-01T15:30:00Z", "1991-12-31T16:00:00Z", "2101-01-01T16:00:00Z", "2020-02-29T16:00:00Z", "2026-10-19T15:59:59Z", "2026-10-20T00:00:00Z"]) {
      expect(formatDate(value, locale)).toBe(expected.format(new Date(value)));
    }
  }
  expect(() => formatDate("invalid", "zh-CN")).toThrow(RangeError);
});

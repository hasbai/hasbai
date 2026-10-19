import { expect, it, vi } from "vitest";
import { load } from "../routes/+page";
const rows = vi.hoisted(() => ({ articles: [] as { id: string; published_at: string | null }[], notes: [] as { id: string; published_at: string | null }[] }));
vi.mock("$lib/public-api", () => ({ publicRepository: () => ({ articles: async () => rows.articles, notes: async () => rows.notes }) }));
it("orders recent writing by publication instant, with stable ties and missing dates last", async () => {
  rows.articles = [{ id: "a", published_at: "2026-10-19T09:00:00+08:00" }, { id: "b", published_at: "2026-10-19T00:30:00Z" }, { id: "draft", published_at: null }];
  rows.notes = [{ id: "new", published_at: "2026-10-19T02:00:00Z" }, { id: "tie", published_at: "2026-10-19T01:00:00Z" }];
  const result = await load({ parent: async () => ({ locale: "zh-CN" }) } as Parameters<typeof load>[0]) as { recent: { id: string }[] };
  expect(result.recent.map(row => row.id)).toEqual(["new", "a", "tie", "b", "draft"]);
});

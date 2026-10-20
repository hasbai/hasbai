import { expect, it, vi } from "vitest";
import { publicRepository } from "./public-api";
it("uses the supplied same-origin fetch for SSR and navigation without forwarding login credentials", async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ data: [] }));
  const repo = publicRepository("en-US", fetcher);
  expect(await repo.articles({ page: 2, limit: 12 })).toEqual([]);
  const [url, options] = fetcher.mock.calls[0];
  expect(String(url).startsWith("/api/public?")).toBe(true);
  const parameters = new URL(String(url), "https://hasbai.xyz").searchParams;
  expect(parameters.get("locale")).toBe("en-US");
  expect(parameters.get("args")).toBe(JSON.stringify([{ page: 2, limit: 12 }]));
  expect(options).toEqual({ credentials: "omit" });
});

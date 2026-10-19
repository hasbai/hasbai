import { beforeEach, expect, it, vi } from "vitest";

const render = vi.hoisted(() => vi.fn(async (source: string) => `<p>${source}</p>`));
vi.mock("./markdown", () => ({ renderMarkdown: render }));
beforeEach(() => {
  vi.resetModules();
  render.mockClear();
});

it("reuses identical text and renders changed text immediately", async () => {
  const { renderPublicMarkdown } = await import("./public-markdown");
  expect(await renderPublicMarkdown("old")).toBe("<p>old</p>");
  expect(await renderPublicMarkdown("old")).toBe("<p>old</p>");
  expect(await renderPublicMarkdown("new")).toBe("<p>new</p>");
  expect(render).toHaveBeenCalledTimes(2);
});

it("does not retain failed rendering", async () => {
  const { renderPublicMarkdown } = await import("./public-markdown");
  render.mockRejectedValueOnce(new Error("render failed"));
  await expect(renderPublicMarkdown("retry")).rejects.toThrow("render failed");
  expect(await renderPublicMarkdown("retry")).toBe("<p>retry</p>");
  expect(render).toHaveBeenCalledTimes(2);
});

it("evicts old entries at the entry limit", async () => {
  const { renderPublicMarkdown } = await import("./public-markdown");
  for (let i = 0; i < 33; i++) await renderPublicMarkdown(String(i));
  await renderPublicMarkdown("32");
  expect(render).toHaveBeenCalledTimes(33);
  await renderPublicMarkdown("0");
  expect(render).toHaveBeenCalledTimes(34);
});

it("bounds retained string bytes and skips oversized results", async () => {
  const { renderPublicMarkdown } = await import("./public-markdown");
  const first = "a".repeat(150_000);
  const second = "b".repeat(150_000);
  await renderPublicMarkdown(first);
  await renderPublicMarkdown(second);
  await renderPublicMarkdown(first);
  expect(render).toHaveBeenCalledTimes(3);
  const oversized = "x".repeat(300_000);
  await renderPublicMarkdown(oversized);
  await renderPublicMarkdown(oversized);
  expect(render).toHaveBeenCalledTimes(5);
});

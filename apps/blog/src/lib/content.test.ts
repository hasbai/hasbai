import { expect, it } from "vitest";
import { dateLabel, yearLabel, articlePath, excerptFromMarkdown, notePath, pagePath } from "./content";
import { articleSchema, noteSchema, pageSchema, pageSlugSchema } from "./content-schema";
import { reservedPageSlugs, isPageSlug } from "./content-paths";
import { renderMarkdown } from "./markdown";
import { boundedImage, imageType, maxImageBytes } from "./images";
it("preserves public content structure while rejecting executable HTML and links", async () => {
  const html = await renderMarkdown(
    '# 标题\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n|a|b|\n|-|-|\n|1|2|\n\n![图](/images/test "图")',
  );
  expect(html).toContain("<h1>标题</h1>");
  expect(html).toContain("<table>");
  expect(html).toContain("/images/test");
  expect(html).toContain("<figcaption>图</figcaption>");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("javascript:");
});
it("uses separate article and note URLs and validates publication", () => {
  expect(articlePath({ slug: "hello-world" })).toBe("/articles/hello-world");
  expect(notePath({ sequence: 18 })).toBe("/notes/18");
  expect(articleSchema.safeParse({ title: "", slug: "x" }).success).toBe(false);
  expect(noteSchema.safeParse({ excerpt: "", markdown: "", cover_id: null, status: "published", published_at: null }).success).toBe(false);
  expect(excerptFromMarkdown("## 标题\n\n[正文](https://example.com)"))
    .toBe("标题 正文");
});
it("checks image bytes rather than trusting content type", () => {
  expect(imageType(new TextEncoder().encode('<svg onload="alert(1)">'))).toBe(
    null,
  );
  expect(imageType(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(
    "image/png",
  );
});
it("bounds chunked uploads even without a content-length header", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(maxImageBytes));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  await expect(
    boundedImage(
      new Request("https://test", {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit),
    ),
  ).rejects.toThrow("10 MB");
});

it("keeps pages on editable root paths and rejects reserved or noncanonical paths", () => {
  expect(pagePath({ slug: "privacy" })).toBe("/privacy");
  for (const slug of [...reservedPageSlugs, "About", "/about", "a/b", "..", "a?b"])
    expect(pageSlugSchema.safeParse(slug).success).toBe(false);
  const fields = { title: "隐私政策", slug: "privacy", excerpt: "", markdown: "政策正文", cover_id: null, status: "published", published_at: "2026-09-23T00:00:00Z" };
  expect(pageSchema.safeParse(fields).success).toBe(true);
  expect(pageSchema.safeParse({ ...fields, markdown: "" }).success).toBe(false);
  expect(pageSchema.safeParse({ ...fields, title: " " }).success).toBe(false);
});

it("formats public dates at the Shanghai year boundary", () => {
  expect(dateLabel("2026-12-31T16:00:00Z")).toBe("2027年1月1日");
  expect(yearLabel("2026-12-31T15:59:59Z")).toBe("2026");
  expect(yearLabel("2026-12-31T16:00:00Z")).toBe("2027");
  expect(dateLabel(null)).toBe("草稿");
});

it("uses the same public path rules for matching and editor validation", () => {
  for (const slug of [...reservedPageSlugs, "about", "a", "a-b-1", "a".repeat(160), "a".repeat(161), "", "About", "a/b", "a?b", "a\n"]) {
    expect(isPageSlug(slug)).toBe(pageSlugSchema.safeParse(slug).success);
  }
});

import { expect, it } from "vitest";
import { renderMarkdown, markdownMetadata, hasMarkdownExtensions } from "./markdown";
import { excerptFromMarkdown } from "./content";

it("parses frontmatter as data without printing it or applying author HTML", async () => {
  const source = '---\ntitle: Metadata title\ntags: [one, two]\n---\n\n正文';
  expect(markdownMetadata(source)).toEqual({ title: "Metadata title", tags: ["one", "two"] });
  expect(await renderMarkdown(source)).toBe("<p>正文</p>");
  expect(excerptFromMarkdown(source)).toBe("正文");
  expect(markdownMetadata('---\na: [broken\n---\n正文')).toEqual({});
});

it("renders GitHub callouts, directive admonitions and safe inline and block math", async () => {
  const html = await renderMarkdown('> [!WARNING]\n> **注意**风险。\n\n:::tip\n可以使用列表。\n\n- 第一步\n:::\n\n行内 $a^2$\n\n$$\n\\frac{1}{2}\n$$');
  expect(html).toContain('callout-warning');
  expect(html).toContain('callout-tip');
  expect(html).toContain('<strong>注意</strong>');
  expect(html).toContain('<li>第一步</li>');
  expect(html).toContain('class="katex"');
  expect(html).toContain('katex-display');
  const hostile = await renderMarkdown('$\\href{javascript:alert(1)}{x}$\n\n<script>alert(1)</script>');
  expect(hostile).not.toContain('href="javascript:');
  expect(hostile).not.toContain('<script');
});

it("keeps numbered footnotes and bibliography citations linked in both directions", async () => {
  const html = await renderMarkdown('---\nreferences:\n  - id: paper\n    title: Research title\n    author: Example\n    year: 2026\n---\n\n脚注[^note] 与文献[@paper]，再引用[@paper]。\n\n[^note]: 脚注正文');
  expect(html).toContain('Research title');
  expect(html).toContain('脚注正文');
  expect(html).toContain('href="#md-fn-note"');
  expect(html).toContain('id="md-fn-note"');
  expect(html).toContain('href="#md-fnref-note"');
  expect(html).toContain('id="md-fnref-note"');
  expect(html).toContain('href="#md-fn-cite-paper"');
  expect(html.match(/Research title/g)).toHaveLength(1);
  expect(await renderMarkdown('未定义[@unknown]')).toContain('[@unknown]');
});

it("preserves diagram source for hydration and protects all unsupported editor syntax", async () => {
  for (const language of ["mermaid", "d2", "markmap"]) {
    const source = '```' + language + '\na -> b\n```';
    expect(hasMarkdownExtensions(source)).toBe(true);
    expect(await renderMarkdown(source)).toContain('language-' + language);
  }
  for (const source of ['---\ntitle: x\n---\n正文', '$x$', '- [x] 已完成', '> [!NOTE]\n> 提示', ':::note\n正文\n:::', '正文[^x]\n\n[^x]: 引用']) expect(hasMarkdownExtensions(source)).toBe(true);
  expect(hasMarkdownExtensions('普通 **正文**\n\n```js\nconst x = 1\n```')).toBe(false);
  expect(hasMarkdownExtensions('`$x$`')).toBe(false);
});


it("keeps bibliography IDs separate from author footnotes and case-sensitive reference keys", async () => {
  const html = await renderMarkdown('---\nreferences:\n  - id: paper\n    title: First reference\n  - id: PAPER\n    title: Second reference\n---\n\n脚注[^cite-paper]，文献[@paper] 与[@PAPER]。\n\n[^cite-paper]: 作者脚注');
  expect(html).toContain('作者脚注');
  expect(html).toContain('First reference');
  expect(html).toContain('Second reference');
  expect(html.match(/<li id="md-fn-/g)).toHaveLength(3);
});


it("renders fenced math while leaving ordinary code literal", async () => {
  const [math, code] = await Promise.all([renderMarkdown("```math\nx^2\n```"), renderMarkdown("```js\nconst price = '$x$';\n```")]);
  expect(math).toContain('class="katex"');
  expect(math).toContain('katex-display');
  expect(code).toContain('class="language-js"');
  expect(code).not.toContain('class="katex"');
});

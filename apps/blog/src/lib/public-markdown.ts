import { renderMarkdown } from "./markdown";

// Cache only completed, pure rendering results, never request-owned promises or
// publication state. Public loaders must fetch and authorize the latest content first.
const rendered = new Map<string, string>();
const maxEntries = 32;
const maxBytes = 1024 * 1024;
let bytes = 0;

export async function renderPublicMarkdown(markdown: string): Promise<string> {
  const cached = rendered.get(markdown);
  if (cached !== undefined) return cached;
  const html = await renderMarkdown(markdown);
  // Two bytes per UTF-16 code unit bounds retained string data without encoding it.
  const size = 2 * (markdown.length + html.length);
  if (size > maxBytes || rendered.has(markdown)) return html;
  while (rendered.size >= maxEntries || bytes + size > maxBytes) {
    const source = rendered.keys().next().value!;
    bytes -= 2 * (source.length + rendered.get(source)!.length);
    rendered.delete(source);
  }
  rendered.set(markdown, html);
  bytes += size;
  return html;
}

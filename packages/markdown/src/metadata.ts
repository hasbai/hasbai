import { parseDocument } from "yaml";

import { frontmatter } from "./frontmatter";
export { stripFrontmatter } from "./frontmatter";

export function markdownMetadata(markdown: string): Record<string, unknown> {
  const match = frontmatter(markdown);
  if (!match) return {};
  try {
    const document = parseDocument(match[1], { uniqueKeys: true });
    if (document.errors.length) return {};
    const value = document.toJS({ maxAliasCount: 50 });
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

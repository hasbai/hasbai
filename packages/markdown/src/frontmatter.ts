export function frontmatter(markdown: string) {
  return /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(markdown);
}

export function stripFrontmatter(markdown: string): string {
  const match = frontmatter(markdown);
  return match ? markdown.slice(match[0].length).trimStart() : markdown;
}

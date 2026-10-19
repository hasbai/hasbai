import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { markdownMetadata } from "./metadata";
export { markdownMetadata } from "./metadata";

type Node = {
  type: string; tagName?: string; name?: string; identifier?: string; lang?: string; checked?: boolean | null;
  properties?: Record<string, unknown>; data?: Record<string, unknown>;
  children?: Node[]; value?: string; position?: { end: { offset?: number } };
};
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
  .use(remarkFrontmatter).use(remarkDirective);
const calloutNames: Record<string, string> = {
  note: "提示", tip: "建议", important: "重要", warning: "警告", caution: "注意",
};

// Tiptap cannot round-trip these extensions. Source remains the editor's truth.
export function hasMarkdownExtensions(markdown: string): boolean {
  const root = parser.parse(markdown) as Node;
  const walk = (node: Node): boolean =>
    (node.type === "listItem" && node.checked != null) ||
    ["yaml", "math", "inlineMath", "footnoteDefinition", "footnoteReference", "containerDirective", "leafDirective", "textDirective"].includes(node.type)
    || (node.type === "text" && /\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]|\[@[\w:-]+/i.test(node.value ?? ""))
    || (node.type === "code" && /^(mermaid|d2|markmap)$/i.test(node.lang ?? ""))
    || Boolean(node.children?.some(walk));
  return walk(root);
}

function extensions() {
  return (tree: unknown, file: { value: unknown }) => {
    const root = tree as Node;
    const metadata = markdownMetadata(String(file.value));
    const references = Array.isArray(metadata.references) ? metadata.references : [];
    const bibliography = new Map<string, string>();
    for (const item of references) {
      if (!item || typeof item !== "object") continue;
      const ref = item as Record<string, unknown>;
      if (typeof ref.id !== "string" || !/^[\w:-]+$/.test(ref.id)) continue;
      const fields = [ref.author, ref.title, ref.year, ref.url].filter(value => typeof value === "string" || typeof value === "number");
      if (fields.length) bibliography.set(ref.id, fields.join(". "));
    }
    const identifiers = new Set<string>();
    const collect = (node: Node) => {
      if (node.type === "footnoteDefinition" && node.identifier) identifiers.add(node.identifier.toUpperCase());
      node.children?.forEach(collect);
    };
    collect(root);
    const cited = new Map<string, string>();
    const citationId = (id: string) => {
      if (cited.has(id)) return cited.get(id)!;
      let identifier = `cite-${id}`;
      while (identifiers.has(identifier.toUpperCase())) identifier += "-ref";
      identifiers.add(identifier.toUpperCase());
      cited.set(id, identifier);
      return identifier;
    };
    const walk = (node: Node) => {
      let kind: string | undefined;
      if (node.type === "containerDirective" && node.name && Object.hasOwn(calloutNames, node.name)) kind = node.name;
      if (node.type === "blockquote") {
        const text = node.children?.[0]?.children?.[0];
        const match = text?.type === "text" && text.value?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s*\n|\s*$)/i);
        if (match) { kind = match[1].toLowerCase(); text!.value = text!.value!.slice(match[0].length); }
      }
      if (kind) {
        node.data = { hName: "aside", hProperties: { className: ["markdown-callout", `callout-${kind}`] } };
        node.children?.unshift({ type: "paragraph", data: { hProperties: { className: ["callout-title"] } }, children: [{ type: "text", value: calloutNames[kind] }] });
      }
      if (!node.children || ["code", "inlineCode", "yaml", "link", "linkReference"].includes(node.type)) return;
      node.children = node.children.flatMap(child => {
        if (child.type !== "text") { walk(child); return [child]; }
        const value = child.value ?? "";
        const result: Node[] = [];
        let end = 0;
        for (const match of value.matchAll(/\[@([\w:-]+)\]/g)) {
          if (!bibliography.has(match[1])) continue;
          result.push({ type: "text", value: value.slice(end, match.index) }, { type: "footnoteReference", identifier: citationId(match[1]) });
          end = match.index! + match[0].length;
        }
        return end ? [...result, { type: "text", value: value.slice(end) }] : [child];
      });
    };
    walk(root);
    for (const [id, identifier] of cited) root.children?.push({
      type: "footnoteDefinition", identifier,
      children: [{ type: "paragraph", children: [{ type: "text", value: bibliography.get(id) }] }],
    });
  };
}

function captions() {
  return (tree: unknown) => {
    const root = tree as Node;
    const walk = (node: Node) => {
      if (!node.children) return;
      node.children = node.children.flatMap(child => {
        if (child.type === "element" && child.tagName === "img") {
          const caption = String(child.properties?.title || child.properties?.alt || "").trim();
          if (caption) return [{ type: "element", tagName: "figure", children: [child, { type: "element", tagName: "figcaption", children: [{ type: "text", value: caption }] }] }];
        }
        walk(child); return [child];
      });
    };
    walk(root);
  };
}

// Ordinary prose does not need KaTeX's formula tables and module initialization.
function mathRenderer() {
  return async (tree: unknown, file: unknown) => {
    const hasMath = (node: Node): boolean => {
      const classes = node.properties?.className;
      return (node.type === "element" && Array.isArray(classes) && classes.some(value => value === "math-inline" || value === "math-display" || value === "language-math")) || Boolean(node.children?.some(hasMath));
    };
    if (!hasMath(tree as Node)) return;
    const { default: rehypeKatex } = await import("rehype-katex");
    const renderer = unified().use(rehypeKatex, { trust: false, strict: "ignore", maxSize: 20, maxExpand: 1000 });
    await renderer.run(tree as Parameters<typeof renderer.run>[0], file as Parameters<typeof renderer.run>[1]);
  };
}

const processor = parser()
  .use(extensions)
  .use(remarkRehype, { footnoteLabel: "参考资料", footnoteBackLabel: "返回引用", clobberPrefix: "md-" })
  .use(captions)
  .use(rehypeSanitize, {
    ...defaultSchema,
    clobberPrefix: "", // remark-rehype prefixes generated IDs; raw HTML is disabled.
    tagNames: [...(defaultSchema.tagNames ?? []), "figure", "figcaption", "aside"],
    attributes: {
      ...defaultSchema.attributes,
      aside: [["className", "markdown-callout", /^callout-/]],
      p: [...(defaultSchema.attributes?.p ?? []), ["className", "callout-title"]],
      code: [["className", /^language-./, "math-inline", "math-display"]],
    },
  })
  .use(mathRenderer)
  .use(rehypeStringify);

export async function renderMarkdown(markdown: string) {
  return String(await processor.process(markdown));
}

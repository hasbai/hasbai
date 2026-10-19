<script lang="ts">
  import { onMount, tick } from "svelte";
  import "katex/dist/katex.min.css";
  let { html }: { html: string } = $props();
  let element = $state<HTMLDivElement>();
  let dark = $state(false);
  onMount(() => {
    const update = () => { dark = document.documentElement.classList.contains("dark"); };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  });
  $effect(() => {
    html; // Track content replacement as well as theme changes.
    const theme = dark;
    let cancelled = false;
    const cleanups: (() => void)[] = [];
    tick().then(async () => {
      if (cancelled || !element || !element.querySelector("pre > code.language-mermaid, pre > code.language-d2, pre > code.language-markmap")) return;
      const { enhanceDiagrams } = await import("./diagrams");
      if (cancelled) return;
      await enhanceDiagrams(element, theme, () => cancelled, cleanups);
    }).catch(() => { /* Text and diagram source remain available if a module fails to load. */ });
    return () => { cancelled = true; cleanups.forEach(cleanup => cleanup()); };
  });
</script>

{#key html + dark}
  <div class="prose" bind:this={element}>{@html html}</div>
{/key}

<style>
  :global(.prose .markdown-callout) { margin: 1.5em 0; padding: 1em 1.2em; border-inline-start: 3px solid #64748b; border-radius: .5em; background: color-mix(in srgb, currentColor 5%, transparent); }
  :global(.prose .markdown-callout p) { margin: .5em 0; }
  :global(.prose .callout-title) { font-weight: 650; }
  :global(.prose .callout-tip) { border-color: #22a06b; }
  :global(.prose .callout-important) { border-color: #8b5cf6; }
  :global(.prose .callout-warning) { border-color: #d99718; }
  :global(.prose .callout-caution) { border-color: #df5555; }
  :global(.prose .katex-display) { overflow-x: auto; overflow-y: hidden; padding-block: .4em; }
  :global(.prose .markdown-diagram) { margin: 1.5em 0; overflow: auto; border: 1px solid var(--border); border-radius: .5em; padding: 1em; }
  :global(.prose .markdown-diagram img) { margin: 0 auto; max-width: 100%; }
  :global(.prose .markdown-diagram svg) { display: block; width: 100%; height: 360px; }
  :global(.prose .markdown-diagram .diagram-controls) { display: flex; justify-content: end; gap: .5em; margin-bottom: .5em; }
  :global(.prose .diagram-controls button) { border: 1px solid var(--border); border-radius: .3em; padding: .2em .6em; font: inherit; font-size: .8em; cursor: pointer; }
  :global(.prose .diagram-error) { color: var(--destructive, #df5555); font-size: .875em; }
  :global(.prose .footnotes) { border-top: 1px solid var(--border); margin-top: 2em; font-size: .875em; }
  :global(.prose .footnotes h2) { font-size: 1em; }
  :global(.prose .markmap-foreign) { color: var(--foreground); }
</style>

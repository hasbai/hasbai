<script lang="ts">
  import { ui, links, dates } from "$lib/i18n";
  const t = ui();
  const dateLabel = dates();
  const link = links();
  import { page } from "$app/state";
  import { languageName } from "$lib/locales";
  import MarkdownContent from "@hasbai/markdown/content";
  import { notePath, site, type Note } from "$lib/content";
  import { ArrowLeft } from "@lucide/svelte";
  let { note, html }: { note: Note; html: string } = $props();
</script>

<svelte:head>
  <title>{t("手记 №")}{note.sequence} · {site.name}</title>
  <meta name="description" content={note.excerpt} />
  <link rel="canonical" href={site.origin + notePath(note)} />
</svelte:head>

<article lang={note.locale} class="reading note-reading entrance">
  <a class="back-link" href={link("/notes")}
    ><ArrowLeft size={16} /> {t("手记")}</a
  >
  {#if note.locale && note.locale !== page.data.locale}<p
      class="meta"
      role="status"
    >
      {t("正在显示{{language}}原文", { language: languageName(note.locale) })}
    </p>{/if}
  <header class="reader-head note-reader-head">
    <span class="eyebrow">LETTER №{note.sequence}</span>
    <h1 class="serif">{t("手记")}</h1>
    <time datetime={note.published_at ?? ""}
      >{dateLabel(note.published_at)}</time
    >
  </header>
  <div class="note-sheet"><MarkdownContent {html} /></div>
  <div class="reader-end">
    <a href={link("/notes")}>{t("← 返回手记")}</a><a
      href={link("/studio/notes/" + note.id)}>{t("编辑手记")}</a
    >
  </div>
</article>

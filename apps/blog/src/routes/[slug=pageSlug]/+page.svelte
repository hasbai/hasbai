<script lang="ts">
  import { ui, links } from "$lib/i18n";
  const t = ui();
  const link = links();
  import MarkdownContent from "@hasbai/markdown/content";
  import { imagePath, pagePath, site } from "$lib/content";
  let { data } = $props();
</script>

<svelte:head>
  <title>{data.page.title} · {site.name}</title>
  <meta name="description" content={data.page.excerpt} />
  <link rel="canonical" href={site.origin + pagePath(data.page)} />
  <meta property="og:type" content="website" />
  <meta property="og:title" content={data.page.title} />
  <meta property="og:description" content={data.page.excerpt} />
  <meta property="og:url" content={site.origin + pagePath(data.page)} />
</svelte:head>
<article lang={data.page.locale} class="reading entrance standalone-page">
  <header class="reader-head">
    <h1 class="article-title">{data.page.title}</h1>
    {#if data.page.excerpt}<p class="article-deck">{data.page.excerpt}</p>{/if}
  </header>
  {#if data.page.cover_id}<img
      class="reader-cover"
      src={imagePath(data.page.cover_id)}
      alt={data.page.title}
    />{/if}
  <MarkdownContent html={data.html} />
  <div class="reader-end">
    <a href={link("/studio/pages/" + data.page.id)}>{t("编辑页面")}</a>
  </div>
</article>

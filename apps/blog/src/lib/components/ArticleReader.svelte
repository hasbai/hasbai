<script lang="ts">
  import { ui, links, dates } from "$lib/i18n";
  const t = ui();
  const dateLabel = dates();
  const link = links();
  import { page } from "$app/state";
  import { languageName } from "$lib/locales";
  import MarkdownContent from "@hasbai/markdown/content";
  import {
    articlePath,
    imagePath,
    readMinutes,
    site,
    type Article,
    type Tag,
  } from "$lib/content";
  import { ArrowLeft } from "@lucide/svelte";
  let { article, html, tags }: { article: Article; html: string; tags: Tag[] } =
    $props();
</script>

<svelte:head>
  <title>{article.title} · {site.name}</title>
  <meta name="description" content={article.excerpt} />
  <link rel="canonical" href={site.origin + articlePath(article)} />
  <meta property="og:type" content="article" />
  <meta property="og:title" content={article.title} />
  <meta property="og:description" content={article.excerpt} />
  <meta property="og:url" content={site.origin + articlePath(article)} />
  {#if article.cover_id}<meta
      property="og:image"
      content={site.origin + imagePath(article.cover_id)}
    />{/if}
</svelte:head>

<article lang={article.locale} class="reading entrance">
  <a class="back-link" href={link("/articles")}
    ><ArrowLeft size={16} /> {t("文章")}</a
  >
  {#if article.locale && article.locale !== page.data.locale}<p
      class="meta"
      role="status"
    >
      {t("正在显示{{language}}原文", {
        language: languageName(article.locale),
      })}
    </p>{/if}
  <header class="reader-head">
    <span class="eyebrow"
      >ARTICLE / {String(article.sequence).padStart(3, "0")}</span
    >
    <h1 class="article-title">{article.title}</h1>
    <div class="reader-meta">
      <time datetime={article.published_at ?? ""}
        >{dateLabel(article.published_at)}</time
      >
      <span>·</span><span>{readMinutes(article.markdown)} {t("分钟阅读")}</span>
    </div>
    {#if article.excerpt}<p class="article-deck">{article.excerpt}</p>{/if}
  </header>
  {#if article.cover_id}<img
      class="reader-cover"
      src={imagePath(article.cover_id)}
      alt={article.title}
    />{/if}
  <MarkdownContent {html} />
  {#if tags.length}<div class="reader-tags" aria-label={t("文章标签")}>
      {#each tags as tag}<a href={link("/tags/" + tag.slug)}>#{tag.name}</a
        >{/each}
    </div>{/if}
  <div class="reader-end">
    <a href={link("/articles")}>{t("← 返回文章")}</a>
    <a href={link("/studio/" + article.id)}>{t("编辑文章")}</a>
  </div>
</article>

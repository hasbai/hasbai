<script lang="ts">
  import { ui, links } from "$lib/i18n";
  const t = ui();
  const link = links();
  import ArticleList from "$lib/components/ArticleList.svelte";
  import { site } from "$lib/content";
  let { data } = $props();
</script>

<svelte:head
  ><title>{t("文章 ·")} {site.name}</title><link
    rel="canonical"
    href={site.origin + link("/articles")}
  /></svelte:head
>
<ArticleList {...data} />

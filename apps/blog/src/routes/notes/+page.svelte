<script lang="ts">
  import { ui, links } from "$lib/i18n";
  const t = ui();
  const link = links();
  import NoteList from "$lib/components/NoteList.svelte";
  import { site } from "$lib/content";
  let { data } = $props();
</script>

<svelte:head
  ><title>{t("手记 ·")} {site.name}</title><link
    rel="canonical"
    href={site.origin + link("/notes")}
  /></svelte:head
>
<NoteList {...data} />

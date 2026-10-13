<script lang="ts">
  import { ui } from "$lib/i18n";
  const t = ui();
  import { onMount } from "svelte";
  import { createAuth } from "$lib/auth.svelte";
  const auth = createAuth();
  onMount(() => {
    void auth.init();
  });
</script>

<svelte:head><meta name="robots" content="noindex,nofollow" /></svelte:head>
<section class="reading empty" role="status">
  {auth.error || t("正在登录…")}
</section>

<script lang="ts">
  import { ui } from "$lib/i18n";
  const t = ui();
  import { onMount, setContext, type Snippet } from "svelte";
  import { createAuth } from "$lib/auth.svelte";
  import { Button } from "@hasbai/ui/button";
  let { children }: { children: Snippet } = $props();
  const auth = createAuth();
  setContext("blog-auth", auth);
  onMount(() => {
    void auth.init();
  });
</script>

{#if auth.loading}<section class="reading empty" role="status">
    {t("正在打开编辑室…")}
  </section>{:else if auth.user && auth.canEdit}{@render children()}{:else}<section
    class="reading empty"
  >
    <span class="meta">THE WRITING ROOM</span>
    <h1 class="serif text-4xl">{t("编辑室")}</h1>
    {#if auth.user}
      <p class="error" role="alert">{t("当前账号没有编辑权限")}</p>
      <Button onclick={() => auth.logout()}>{t("退出登录")}</Button>
    {:else}
      {#if auth.error}<p class="error" role="alert">{auth.error}</p>{/if}
      <Button onclick={() => auth.login()}>{t("登录")}</Button>
    {/if}
  </section>{/if}

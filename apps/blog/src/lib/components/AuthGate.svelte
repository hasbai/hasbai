<script lang="ts">
  import { Notice, useNotifications } from "@hasbai/ui/notice";
  import { ui } from "$lib/i18n";
  const t = ui();
  import { onMount, setContext, type Snippet } from "svelte";
  import { createAuth } from "$lib/auth.svelte";
  import { Button } from "@hasbai/ui/button";
  let { children }: { children: Snippet } = $props();
  const auth = createAuth();
  const notifications = useNotifications();
  $effect(() => {
    if (auth.error) notifications.show(t(auth.error), "error");
  });
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
    <h1 class="serif text-4xl">{t("编辑室")}</h1>
    {#if auth.user}
      <Notice variant="error">{t("当前账号没有编辑权限")}</Notice>
      <Button onclick={() => auth.logout()}>{t("退出登录")}</Button>
    {:else}
      <Button onclick={() => auth.login()}>{t("登录")}</Button>
    {/if}
  </section>{/if}

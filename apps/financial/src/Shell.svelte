<script lang="ts">
 import { pageMotion } from "@hasbai/ui/motion";
  import { onMount } from "svelte";
  import {
    Wallet,
    ReceiptText,
    Settings,
    Plus,
    Eye,
    EyeOff,
    Moon,
    Sun,
    LogOut,
    MoreHorizontal,
    House,
  } from "@lucide/svelte";
  import { Button } from "@hasbai/ui/button";
  import * as Popover from "@hasbai/ui/popover";
  import * as Card from "@hasbai/ui/card";
  import Notice from "./components/Notice.svelte";
  import Loading from "./components/Loading.svelte";
  import Empty from "./components/Empty.svelte";
  import { router } from "./lib/router.svelte";
  import type { createAuth } from "./lib/auth.svelte";
  let {
    auth,
    clearCache,
  }: { auth: ReturnType<typeof createAuth>; clearCache: () => void } = $props();
  let dark = $state(false);
  let hidden = $state(localStorage.getItem("financial.hideAmounts") === "true");
  let themeChosen = false;
  onMount(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    dark = media.matches;
    const changed = () => {
      if (!themeChosen) dark = media.matches;
    };
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  });
  $effect(() => {
    document.documentElement.classList.toggle("dark", dark);
  });
  const nav = [
    { path: "/", label: "总览", icon: House },
    { path: "/transactions", label: "流水", icon: ReceiptText },
    { path: "/settings", label: "设置", icon: Settings },
  ];
  let path = $derived(router.location.pathname);
  let editingTransaction = $derived(path.startsWith("/transactions/"));
  function activeNav(destination: string) {
    return destination === "/"
      ? path === "/"
      : path.startsWith(destination) ||
          (destination === "/settings" && path === "/accounts");
  }
  let authorized = $derived(auth.authorized);
  function toggleAmounts() {
    hidden = !hidden;
    localStorage.setItem("financial.hideAmounts", String(hidden));
  }
</script>

{#if auth.loading}
  <main class="grid min-h-dvh place-items-center" aria-label="正在登录">
    <Loading />
  </main>
{:else if !auth.user}
  <main
    class="grid min-h-dvh place-items-center px-5 pt-[max(40px,env(safe-area-inset-top))] pb-[max(40px,env(safe-area-inset-bottom))]"
  >
    <Card.Root class="w-full max-w-md">
      <Card.Content class="space-y-6 p-8 sm:p-10">
        <div
          class="grid size-14 place-items-center rounded-xl bg-primary text-primary-foreground"
        >
          <Wallet class="size-7" aria-hidden="true" />
        </div>
        <p class="font-semibold text-primary">北极账本</p>
        <h1 class="text-3xl font-semibold tracking-tight">
          每一笔，都心中有数。
        </h1>
        {#if auth.error}<Notice variant="error">{auth.error}</Notice>{/if}
        <Button
          class="w-full"
          disabled={auth.loading}
          onclick={() => auth.login()}
          >{auth.loading ? "正在验证登录…" : "使用北极小站登录"}</Button
        >
      </Card.Content>
    </Card.Root>
  </main>
{:else}
  <a href="#main" class="skip-link">跳到主要内容</a>
  <aside
    class="fixed inset-y-0 left-0 hidden w-56 flex-col gap-2 border-r bg-sidebar p-5 text-sidebar-foreground md:flex"
  >
    <a
      href="/"
      class="mb-8 flex min-h-12 items-center gap-3 px-3 text-lg font-semibold"
      ><Wallet class="size-6 text-primary" aria-hidden="true" />北极账本</a
    >
    <nav aria-label="主要导航" class="space-y-2">
      {#each nav as item}
        <Button
          href={item.path}
          variant={activeNav(item.path) ? "default" : "ghost"}
          class="w-full justify-start"
          aria-current={activeNav(item.path) ? "page" : undefined}
          ><item.icon aria-hidden="true" />{item.label}</Button
        >
      {/each}
    </nav>
  </aside>
  <div class="relative min-h-dvh md:ml-56">
    <header
      class:transaction-chrome={editingTransaction}
      class="absolute top-[calc(20px+env(safe-area-inset-top))] right-[max(16px,env(safe-area-inset-right))] z-20 sm:right-8"
      aria-label="应用设置"
    >
      <Popover.Root
        ><Popover.Trigger
          >{#snippet child({ props })}<Button
              {...props}
              variant="ghost"
              size="icon"
              aria-label="应用菜单"
              ><MoreHorizontal class="size-6" aria-hidden="true" /></Button
            >{/snippet}</Popover.Trigger
        ><Popover.Content
          class="w-48 gap-1 p-2"
          align="end"
          collisionPadding={16}
          ><Button
            class="w-full justify-start"
            variant="ghost"
            onclick={toggleAmounts}
            >{#if hidden}<EyeOff aria-hidden="true" />显示金额{:else}<Eye
                aria-hidden="true"
              />隐藏金额{/if}</Button
          ><Button
            class="w-full justify-start"
            variant="ghost"
            onclick={() => {
              themeChosen = true;
              dark = !dark;
            }}
            >{#if dark}<Sun aria-hidden="true" />浅色外观{:else}<Moon
                aria-hidden="true"
              />深色外观{/if}</Button
          ><Button
            class="w-full justify-start"
            variant="ghost"
            onclick={() => auth.logout(clearCache)}
            ><LogOut aria-hidden="true" />退出登录</Button
          ></Popover.Content
        ></Popover.Root
      >
    </header>
    <main use:pageMotion={path}
      id="main"
      class:transaction-main={editingTransaction}
      class="app-main mx-auto min-w-0 max-w-5xl pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] pt-[calc(20px+env(safe-area-inset-top))] pb-[calc(156px+env(safe-area-inset-bottom))] sm:px-8"
    >
      {#if !authorized}
        <Empty title="当前账号没有访问权限" />
      {:else if path === "/"}
        {#await import("./pages/Overview.svelte")}<Loading
          />{:then page}<page.default
            {hidden}
            onToggleAmounts={toggleAmounts}
          />{/await}
      {:else if path === "/transactions"}
        {#await import("./pages/Transactions.svelte")}<Loading
          />{:then page}<page.default {hidden} />{/await}
      {:else if editingTransaction}
        {#await import("./pages/Editor.svelte")}<Loading
          />{:then page}{#key path}<page.default {hidden} />{/key}{/await}
      {:else if path === "/settings"}
        {#await import("./pages/Settings.svelte")}<Loading
          />{:then page}<page.default />{/await}
      {:else if path === "/accounts"}
        {#await import("./pages/Accounts.svelte")}<Loading
          />{:then page}<page.default />{/await}
      {:else}
        <Empty title="页面不存在"><Button href="/">回到总览</Button></Empty>
      {/if}
    </main>
  </div>
  {#if authorized && path !== "/accounts" && !path.startsWith("/transactions/")}
    <Button
      href="/transactions/new"
      aria-label="记一笔"
      class="mobile-create fixed right-5 bottom-[calc(88px+env(safe-area-inset-bottom))] z-20 h-16 w-16 rounded-full p-0 shadow-lg md:right-10 md:bottom-8"
      ><Plus class="size-7" aria-hidden="true" /></Button
    >
  {/if}
  <nav
    class:transaction-chrome={editingTransaction}
    aria-label="移动导航"
    class="mobile-navigation fixed inset-x-0 bottom-0 z-30 flex h-[calc(68px+env(safe-area-inset-bottom))] items-start justify-around border-t bg-card/95 backdrop-blur-md pt-2 pb-[env(safe-area-inset-bottom)] md:hidden"
  >
    {#each nav as item}<a
        href={item.path}
        aria-current={activeNav(item.path) ? "page" : undefined}
        class="flex min-h-12 min-w-16 flex-col items-center justify-center gap-1 text-xs text-muted-foreground aria-[current=page]:text-primary"
        ><item.icon class="size-5" aria-hidden="true" />{item.label}</a
      >{/each}
  </nav>
{/if}

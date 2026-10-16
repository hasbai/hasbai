<script lang="ts">
 import { pageMotion } from "@hasbai/ui/motion";
  import { onMount } from "svelte";
  import { Button } from "@hasbai/ui/button";
  import {
    LayoutDashboard,
    Server,
    Users,
    Files,
    Link,
    ScrollText,
    Sun,
    Moon,
    LogOut,
    RefreshCw,
  } from "@lucide/svelte";
  import type { Api, Me } from "./lib/types";
  import Subscription from "./pages/Subscription.svelte";
  import Overview from "./pages/Overview.svelte";
  import Nodes from "./pages/Nodes.svelte";
  import Templates from "./pages/Templates.svelte";
  import Members from "./pages/Members.svelte";
  import Reports from "./pages/Reports.svelte";
  let { api, logout }: { api: Api; logout: () => void } = $props();
  let me = $state<Me>(),
    error = $state(""),
    loading = $state(true),
    page = $state("subscription"),
    dark = $state(false),
    hidden = $state(false),
    revision = $state(0);
  const nav = [
    { id: "overview", name: "总览", icon: LayoutDashboard },
    { id: "nodes", name: "节点", icon: Server },
    { id: "templates", name: "配置模板", icon: Files },
    { id: "members", name: "用户", icon: Users },
    { id: "reports", name: "报告", icon: ScrollText },
    { id: "subscription", name: "我的订阅", icon: Link },
  ];
  onMount(() => {
    dark =
      localStorage.getItem("zboard-theme") === "dark" ||
      (!localStorage.getItem("zboard-theme") &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    void load();
    const route = () => {
      page = location.hash.slice(1) || "subscription";
    };
    route();
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  });
  async function load() {
    loading = true;
    error = "";
    try {
      me = await api.request<Me>("/me");
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
  function theme() {
    dark = !dark;
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("zboard-theme", dark ? "dark" : "light");
  }
</script>

<a class="skip" href="#main-content">跳至内容</a>
<div class="shell">
  <aside class="sidebar">
    <div class="brand"><span class="login-mark">Z</span>Zboard</div>
    <nav class="nav" aria-label="主导航">
      {#each nav.filter((n) => me?.admin || n.id === "subscription") as item}<a
          href={"#" + item.id}
          aria-current={page === item.id ? "page" : undefined}
          ><item.icon size={18} aria-hidden="true" />{item.name}</a
        >{/each}
    </nav>
    <div class="sidebar-bottom">
      <span class="account-name muted wrap">{me?.user.email ?? "北极小站"}</span
      >
      <div class="actions">
        <Button
          variant="ghost"
          size="icon"
          aria-label={dark ? "切换浅色" : "切换深色"}
          onclick={theme}
          >{#if dark}<Sun />{:else}<Moon />{/if}</Button
        ><Button
          variant="ghost"
          size="icon"
          aria-label="退出登录"
          onclick={logout}><LogOut /></Button
        >
      </div>
    </div>
  </aside>
  <main use:pageMotion={page} id="main-content" class="content" tabindex="-1">
    {#if loading}<div class="stack" role="status" aria-label="正在加载">
        <div class="skeleton"></div>
        <div class="skeleton"></div>
      </div>
    {:else if error}<div class="empty">
        <p class="error" role="alert">{error}</p>
        <Button onclick={load}>重试</Button>
      </div>
    {:else if me}
      <header class="page-head">
        <div>
          <p class="eyebrow">北极小站 / {me.admin ? "管理面板" : "用户中心"}</p>
          <h1>{nav.find((n) => n.id === page)?.name ?? "我的订阅"}</h1>
        </div>
        <div class="actions">
          <Button variant="ghost" onclick={() => (hidden = !hidden)}
            >{hidden ? "显示用量" : "隐藏用量"}</Button
          ><Button
            variant="outline"
            aria-label="刷新页面"
            onclick={() => {
              revision++;
              if (page === "subscription") void load();
            }}><RefreshCw size={16} /><span>刷新</span></Button
          >
        </div>
      </header>
      {#key page + revision}
        {#if page === "subscription"}<Subscription
            {api}
            {me}
            {hidden}
            onrefresh={load}
          />
        {:else if !me.admin}<div class="empty">
            <h2>需要管理员权限</h2>
            <Button href="#subscription">我的订阅</Button>
          </div>
        {:else if page === "overview"}<Overview {api} {hidden} />
        {:else if page === "nodes"}<Nodes {api} />
        {:else if page === "templates"}<Templates {api} />
        {:else if page === "members"}<Members {api} {hidden} />
        {:else if page === "reports"}<Reports {api} />
        {:else}<Subscription {api} {me} {hidden} onrefresh={load} />{/if}
      {/key}
    {/if}
  </main>
</div>

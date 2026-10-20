<script lang="ts">
 import { LoadingBar } from "@hasbai/ui/progress";
 import { Notice } from '@hasbai/ui/notice';
  import { onMount } from "svelte";
  import { createBrowserClient } from "@hasbai/auth";
  import { Button } from "@hasbai/ui/button";
  import BrandMark from "./lib/BrandMark.svelte";
  import Tavern from "./Tavern.svelte";
  import { createApi } from "./lib/api";
  import type { Api } from "./lib/api";
  let loading = $state(true),
    authenticated = $state(false),
    error = $state("");
  let api = $state<Api>();
  let client: ReturnType<typeof createBrowserClient>;
  onMount(() => {
    void init();
  });
  async function init() {
    try {
      client = createBrowserClient(location.origin);
      if (location.pathname === "/auth/callback") {
        await client.handleRedirectCallback();
        history.replaceState({}, "", "/");
      } else {
        try {
          await client.checkSession();
        } catch {
          /* Manual login remains available. */
        }
      }
      authenticated = await client.isAuthenticated();
      if (authenticated) api = createApi(async () => { const token = await client.getTokenSilently(); if (!token) throw new Error("请重新登录"); return token; });
    } catch (e) {
      error = e instanceof Error ? e.message : "登录失败";
    } finally {
      loading = false;
    }
  }
  async function login() {
    loading = true;
    error = "";
    try {
      await client.loginWithRedirect();
    } catch {
      error = "无法打开登录，请重试";
      loading = false;
    }
  }
  async function logout() {
    loading = true;
    authenticated = false;
    api = undefined;
    try {
      await client.logout({ logoutParams: { returnTo: location.origin } });
    } catch {
      error = "退出失败，请重试";
      loading = false;
    }
  }
</script>

{#if authenticated && api}<Tavern {api} {logout} />{:else}
  <LoadingBar active={loading}/><main class="login" aria-busy={loading}>
    <div class="login-mark"><BrandMark size={42}/></div>
    <p class="eyebrow">北极小站</p>
    <h1>Tavern</h1>
    {#if !loading}<Button
        onclick={login}>登录</Button
      >{/if}
    {#if error}<Notice variant="error">{error}</Notice>{/if}
  </main>
{/if}

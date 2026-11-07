<script lang="ts">
 import { onMount } from 'svelte';
 import { createBrowserClient } from '@hasbai/auth';
 import { Button } from '@hasbai/ui/button';
 import { Notice } from '@hasbai/ui/notice';
 import Console from './Console.svelte';
 import { createApi, type Api } from './lib';
 let api = $state<Api>(), loading = $state(true), error = $state('');
 let client: ReturnType<typeof createBrowserClient>;
 onMount(() => {void init();});
 async function init() {
  try {
   client = createBrowserClient(location.origin);
   if (location.pathname === '/auth/callback') {await client.handleRedirectCallback(); history.replaceState({}, '', '/');}
   else {try {await client.checkSession();} catch {}}
   if (await client.isAuthenticated()) api = createApi(async () => {const token=await client.getTokenSilently();if(!token)throw Error('请重新登录');return token;});
  } catch {error = '登录恢复失败，请重新登录';} finally {loading = false;}
 }
 async function login() {try {await client.loginWithRedirect();} catch {error = '登录失败，请重试';}}
 async function logout() {api = undefined; await client.logout({logoutParams: {returnTo: location.origin}});}
</script>
{#if api}<Console {api} {logout}/>{:else}<main class="login"><span class="eyebrow">北极小站</span><h1>AI</h1><p>登录后使用对话、翻译、图片和向量模型。</p>{#if loading}<p role="status">正在恢复登录…</p>{:else}<Button onclick={login}>登录</Button>{/if}{#if error}<Notice variant="error">{error}</Notice>{/if}</main>{/if}

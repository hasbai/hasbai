<script lang="ts">
 import {onMount} from 'svelte';
 import {createBrowserClient} from '@hasbai/auth';
 import {Button} from '@hasbai/ui/button';
 import {Notice} from '@hasbai/ui/notice';
 import Library from './pages/Library.svelte';
 import {createApi,type Api} from './lib';
 let api=$state<Api>(),loading=$state(true),error=$state('');
 let client:ReturnType<typeof createBrowserClient>;
 onMount(()=>{void init();});
 async function init(){try{client=createBrowserClient(location.origin);if(location.pathname==='/auth/callback'){const result=await client.handleRedirectCallback();const target=result.appState?.returnTo;history.replaceState({},'',typeof target==='string'&&/^\/library\/[0-9a-f-]{36}$/i.test(target)?target:'/');}else{try{await client.checkSession();}catch{}}
 if(await client.isAuthenticated())api=createApi(async()=>{const token=await client.getTokenSilently();if(!token)throw Error('请重新登录');return token;});}catch(e){error=(e as Error).message;}finally{loading=false;}}
 async function login(){try{await client.loginWithRedirect({appState:{returnTo:location.pathname}});}catch{error='登录失败，请重试';}}
 async function logout(){api=undefined;await client.logout({logoutParams:{returnTo:location.origin}});}
</script>
{#if api}<Library {api} {logout}/>{:else}<main class="login"><h1>图床</h1>{#if loading}<p role="status">正在恢复登录…</p>{:else}<Button onclick={login}>登录</Button>{/if}{#if error}<Notice variant="error">{error}</Notice>{/if}</main>{/if}

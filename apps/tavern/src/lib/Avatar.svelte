<script lang="ts">
 import type { Api } from './api';
 let { api, id, name, available=false }: {api:Api;id:string;name:string;available?:boolean}=$props();
 let url=$state('');
 $effect(()=>{let alive=true;url='';if(available)void api.avatar(id).then(value=>{if(alive)url=value;else URL.revokeObjectURL(value);}).catch(()=>{});return()=>{alive=false;if(url)URL.revokeObjectURL(url);};});
</script>
<div class="avatar">{#if url}<img src={url} alt={name} width="64" height="64" />{:else}<span aria-hidden="true">{name.slice(0,1)}</span>{/if}</div>

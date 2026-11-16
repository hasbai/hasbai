<script lang="ts">
 import * as Dialog from '@hasbai/ui/dialog';
 import { Button } from '@hasbai/ui/button';
 import { Input } from '@hasbai/ui/input';
 import { Check, Search, Network, Cpu, ChevronDown, X } from '@lucide/svelte';
 import { groups, type Model } from './catalog';
 let {models, value = $bindable(''), disabled = false}: {models: Model[]; value?: string; disabled?: boolean} = $props();
 let open = $state(false), query = $state('');
 let grouped = $derived(groups(models, query));
 let selected = $derived(models.find(m=>m.id===value));
</script>
<Dialog.Root bind:open onOpenChange={v=>{if(!v)query='';}}>
 <Dialog.Trigger class="model-trigger" {disabled}><Cpu size={17}/><span>{selected?.name || '选择模型'}</span><ChevronDown size={15}/></Dialog.Trigger>
 <Dialog.Content class="model-dialog" showCloseButton={false}>
  <Dialog.Header><div class="catalog-heading"><div><Dialog.Title>选择模型</Dialog.Title><Dialog.Description>{models.length} 个模型 · 按 Provider 分组</Dialog.Description></div><Dialog.Close class="icon-control" aria-label="关闭模型选择"><X size={20}/></Dialog.Close></div></Dialog.Header>
  <div class="catalog-search"><Search size={18}/><Input aria-label="搜索模型" placeholder="搜索模型或 Provider" bind:value={query}/></div>
  <div class="catalog-scroll">
   {#each grouped as [provider, items] (provider)}
    <section class="provider-group"><header><span class="provider-avatar">{#if provider==='动态路由'}<Network size={18}/>{:else}{provider.slice(0,1).toUpperCase()}{/if}</span><h3>{provider}</h3><span>{items.length} 个模型</span></header>
     <div class="model-grid">{#each items as model (model.id)}
      <article class:selected={value===model.id} class="model-card"><div class="model-card-heading"><h4>{model.name}</h4>{#if value===model.id}<Check size={17} aria-label="已选择"/>{/if}</div><code>{model.id}</code>
       <p>{model.description || (model.id.startsWith('dynamic/') ? '按已部署的路由规则分配请求' : '通过此 Provider 调用对话模型')}</p>
       <dl><div><dt>上下文</dt><dd>{model.context_tokens ? model.context_tokens.toLocaleString()+' tokens' : '上游未提供'}</dd></div><div><dt>调用方式</dt><dd>{model.id.startsWith('dynamic/')?'动态路由':'直接调用'}</dd></div></dl>
       <Button variant={value===model.id?'default':'outline'} onclick={()=>{value=model.id;open=false;}}>{value===model.id?'使用当前模型':'使用此模型'}</Button>
      </article>
     {/each}</div>
    </section>
   {:else}<div class="catalog-empty">{query?'没有匹配的模型':'暂无可用模型'}</div>{/each}
  </div>
 </Dialog.Content>
</Dialog.Root>

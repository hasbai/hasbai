<script lang="ts">
 import { onMount, onDestroy } from 'svelte';
 import { Button } from '@hasbai/ui/button';
 import { Notice } from '@hasbai/ui/notice';
 import { Textarea } from '@hasbai/ui/textarea';
 import { ModelPicker } from '@hasbai/ui/model-picker';
 import { Sparkles, LogOut, Sun, Moon, ArrowUpRight, Send, Square } from '@lucide/svelte';
 import Manager from './Manager.svelte';
 import type { Api } from './lib';
 let {api, logout}: {api: Api; logout: () => void} = $props();
 let admin = $state(false), loading = $state(true), error = $state(''), tab = $state('use'), dark = $state(false);
 let prompt = $state(''), output = $state(''), busy = $state(false), model = $state('default'), models = $state<{id: string; name: string; provider?: string; context_tokens?: number}[]>([]), modelError = $state('');
 let abort: AbortController | undefined;
 onMount(() => {dark = document.documentElement.classList.contains('dark'); void init(); void loadModels();});
 onDestroy(() => abort?.abort());
 async function init() {error = ''; loading = true; try {admin = ((await (await api('/api/me')).json()) as {admin:boolean}).admin;} catch (e) {error = (e as Error).message;} finally {loading = false;}}
 async function loadModels() {
  modelError = '';
  try {
   const list = (await (await api('/v1/models')).json()) as {data: {id: string; name: string; type: string; provider?: string; context_tokens?: number}[]};
   models = list.data.filter(item => item.type === 'chat');
   if (!models.some(item => item.id === model)) model = models[0]?.id ?? '';
  } catch (e) {modelError = (e as Error).message;}
 }
 function theme() {dark = !dark; document.documentElement.classList.toggle('dark', dark);}
 async function generate() {
  if (busy || !prompt.trim()) return;
  busy = true; error = ''; output = ''; const active = new AbortController(); abort = active;
  try {
   const response = await api('/v1/chat/completions', 'POST', {model, stream: true, messages: [{role: 'user', content: prompt}]}, active.signal);
   if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw Error('模型未返回流式回复');
   const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '', finishReason = '';
   try {
    for (;;) {
     const {done, value} = await reader.read(); if (done) break;
     pending = (pending + decoder.decode(value, {stream: true})).replace(/\r\n/g, '\n');
     let end;
     while ((end = pending.indexOf('\n\n')) >= 0) {
      const lines = pending.slice(0, end).split('\n'); pending = pending.slice(end + 2);
      const raw = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!raw) continue; if (raw === '[DONE]') continue;
      const item = JSON.parse(raw); if (item.error) throw Error('模型生成失败，请重试');
      const choice = item.choices?.[0]; if (typeof choice?.delta?.content === 'string') output += choice.delta.content;
      if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
     }
    }
    if (finishReason !== 'stop' || !output.trim()) throw Error('模型回复未完成，请重试');
   } finally {await reader.cancel().catch(() => {});}
  } catch (e) {if (!active.signal.aborted) error = (e as Error).message;} finally {busy = false;}
 }
</script>
<svelte:head><title>AI · 北极小站</title></svelte:head>
<header class="app-header"><a class="brand" href="/"><Sparkles size={23} aria-hidden="true"/>AI</a><nav aria-label="应用"><a href="https://hasbai.xyz">博客<ArrowUpRight size={14}/></a><Button variant="ghost" onclick={theme} aria-label={dark?'切换浅色模式':'切换深色模式'}>{#if dark}<Sun size={18}/>{:else}<Moon size={18}/>{/if}</Button><Button variant="ghost" onclick={logout} aria-label="退出登录"><LogOut size={18}/></Button></nav></header>
<main class="ai-workspace"><header class="ai-heading"><div><span class="eyebrow">北极小站</span><h1>AI 工作台</h1><p>选择模型，开始一次对话。</p></div><span class="service-badge"><span></span>Cloudflare AI Gateway</span></header>
{#if loading}<p role="status">正在加载…</p>{:else if error && !admin && tab !== 'use'}<Notice variant="error">{error}<Button onclick={init}>重试</Button></Notice>{:else}
{#if admin}<nav class="tabs" aria-label="工作台视图"><Button variant={tab==='use'?'default':'ghost'} aria-pressed={tab==='use'} onclick={()=>tab='use'}>使用 AI</Button><Button variant={tab==='manage'?'default':'ghost'} aria-pressed={tab==='manage'} onclick={()=>tab='manage'}>Provider 与密钥</Button></nav>{/if}
{#if tab==='manage' && admin}<Manager {api}/>{:else}
<div class="use-layout"><section class="panel compose"><div class="panel-heading"><h2>新对话</h2></div><div class="model-field"><label for="model-search">对话模型</label><ModelPicker id="model-search" bind:value={model} models={models.map(item => ({id: item.id, name: item.name, provider: item.provider, contextTokens: item.context_tokens}))} disabled={busy}/>{#if modelError}<Button variant="ghost" type="button" onclick={loadModels}>{modelError} 重试</Button>{/if}</div><form onsubmit={e=>{e.preventDefault();void generate();}}><label for="prompt">你的消息</label><Textarea id="prompt" bind:value={prompt} rows={8} placeholder="输入问题或想翻译的内容…" disabled={busy}/><div class="compose-actions">{#if busy}<span role="status">正在生成…</span><Button variant="outline" type="button" onclick={()=>abort?.abort()}><Square size={14}/>停止</Button>{:else}<Button type="submit" disabled={!prompt.trim() || !model}><Send size={16}/>发送</Button>{/if}</div></form></section>
<section class="panel response" aria-labelledby="response-title"><div class="panel-heading"><h2 id="response-title">回复</h2></div>{#if output}<pre>{output}</pre>{:else}<div class="response-empty"><Sparkles size={28} aria-hidden="true"/><p>模型回复会显示在这里</p></div>{/if}</section></div>
{#if error}<Notice variant="error">{error}</Notice>{/if}
<section class="api-note"><h2>API 接入</h2><p>使用 Auth0 用户访问令牌调用，支持流式回复。</p><code>https://ai.hasbai.xyz/v1</code><div class="api-paths"><span>POST /chat/completions</span><span>POST /images/generations</span><span>POST /embeddings</span><span>GET /models</span></div></section>
{/if}{/if}</main>

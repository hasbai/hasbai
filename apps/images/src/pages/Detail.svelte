<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '@hasbai/ui/button';
  import { Input } from '@hasbai/ui/input';
  import { Notice } from '@hasbai/ui/notice';
  import * as Dialog from '@hasbai/ui/dialog';
  import { ArrowLeft, Copy, Download, Pencil, Trash2 } from '@lucide/svelte';
  import type { ImageAsset } from '@hasbai/images';
  import { previewUrl, type Api } from '../lib';

  let { api, id, back, deleted }: { api: Api; id: string; back: () => void; deleted: () => void } = $props();
  let image = $state<ImageAsset & { can_manage: boolean; deleting: boolean }>();
  let loading = $state(true), error = $state(''), status = $state('');
  let editing = $state(false), name = $state(''), saving = $state(false), editError = $state('');
  let confirming = $state(false), deleting = $state(false), deleteError = $state('');
  onMount(() => { void load(); });
  async function load() {
    loading = true; error = '';
    try { image = await api.get(id); if(image.deleting){confirming=true;deleteError='图片删除尚未完成，请重试。';} } catch (e) { error = (e as Error).message; }
    finally { loading = false; }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(image!.url); status = '已复制图片链接'; }
    catch { error = '复制失败，请选择链接复制'; }
  }
  async function rename(event: SubmitEvent) {
    event.preventDefault(); if (saving) return;
    saving = true; editError = '';
    try { image = { ...await api.rename(id, name), can_manage: true, deleting: false }; editing = false; status = '已重命名'; }
    catch (e) { editError = (e as Error).message; }
    finally { saving = false; }
  }
  async function remove() {
    if (deleting) return;
    deleting = true; deleteError = '';
    try { await api.remove(id); confirming = false; deleted(); }
    catch (e) { deleteError = (e as Error).message + '。可重试完成删除。'; }
    finally { deleting = false; }
  }
</script>
<svelte:head><title>{image?.name ?? '图片详情'} · 图床</title></svelte:head>
<div class="detail-heading"><Button variant="ghost" onclick={back}><ArrowLeft size={17} aria-hidden="true"/>返回图片库</Button></div>
{#if loading}
  <div class="empty" role="status">正在加载图片…</div>
{:else if image}
  <div class="image-detail">
    <div class="detail-preview">{#if !image.deleting}<img src={previewUrl(image, 'display')} alt={image.name}/>{:else}<p>正在等待完成删除</p>{/if}</div>
    <section class="detail-info" aria-label="图片详情">
      <h1>{image.name}</h1>
      <dl><div><dt>格式</dt><dd>{image.content_type.replace('image/', '').toUpperCase()}</dd></div><div><dt>原图大小</dt><dd>{(image.size / 1024).toFixed(0)} KB</dd></div><div><dt>创建时间</dt><dd>{new Date(image.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</dd></div>{#if image.model}<div><dt>生成模型</dt><dd>{image.model.endsWith('sunburst') ? 'Sunburst' : 'Flare'}</dd></div>{/if}</dl>
      <label for="image-url">图片 URL</label><Input id="image-url" readonly value={image.url} onclick={event => event.currentTarget.select()}/>
      <div class="detail-actions"><Button variant="outline" onclick={copy}><Copy size={16} aria-hidden="true"/>复制链接</Button><Button variant="outline" href={`/images/${encodeURIComponent(id)}?download=1`}><Download size={16} aria-hidden="true"/>下载原图</Button></div>
      {#if image.can_manage}<div class="detail-management"><Button variant="outline" onclick={() => { name = image!.name; editError = ''; editing = true; }}><Pencil size={16} aria-hidden="true"/>重命名</Button><Button variant="destructive" onclick={() => { deleteError = ''; confirming = true; }}><Trash2 size={16} aria-hidden="true"/>删除图片</Button></div>{/if}
      {#if status}<p class="feedback" role="status">{status}</p>{/if}
    </section>
  </div>
{/if}
{#if error}<Notice variant="error">{error}<Button variant="outline" onclick={load}>重试</Button></Notice>{/if}
<Dialog.Root open={editing} onOpenChange={open => { if (!saving) editing = open; }}><Dialog.Content onInteractOutside={event=>{if(saving)event.preventDefault();}} onEscapeKeydown={event=>{if(saving)event.preventDefault();}}><Dialog.Header><Dialog.Title>重命名图片</Dialog.Title></Dialog.Header><form class="rename" onsubmit={rename}><label for="name">图片名称</label><Input id="name" bind:value={name} maxlength={240}/>{#if editError}<Notice variant="error">{editError}</Notice>{/if}<Dialog.Footer><Button type="button" variant="outline" disabled={saving} onclick={() => editing = false}>取消</Button><Button type="submit" disabled={saving || !name.trim()}>{saving ? '保存中…' : '保存'}</Button></Dialog.Footer></form></Dialog.Content></Dialog.Root>
<Dialog.Root open={confirming} onOpenChange={open => { if (!deleting && !deleteError) confirming = open; }}><Dialog.Content onInteractOutside={event=>{if(deleting||deleteError)event.preventDefault();}} onEscapeKeydown={event=>{if(deleting||deleteError)event.preventDefault();}}><Dialog.Header><Dialog.Title>删除图片？</Dialog.Title><Dialog.Description>将永久删除「{image?.name}」。公开链接将失效，博客封面会移除，博客正文和酒馆中使用它的位置也会受影响。</Dialog.Description></Dialog.Header>{#if deleteError}<Notice variant="error">{deleteError}</Notice>{/if}<Dialog.Footer><Button variant="outline" disabled={deleting} onclick={() => { confirming = false; if(deleteError)back(); }}>取消</Button><Button variant="destructive" disabled={deleting} onclick={remove}>{deleting ? '删除中…' : deleteError ? '重试删除' : '确认删除'}</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<script lang="ts">
 import { trackLoading, Spinner } from "@hasbai/ui/progress";
 import { onDestroy, untrack, type Snippet } from 'svelte';
 import { Button } from '@hasbai/ui/button';
 import { Input } from '@hasbai/ui/input';
 import { Notice } from '@hasbai/ui/notice';
 import * as Dialog from '@hasbai/ui/dialog';
 import { Check, Sparkles, UserRound, BookOpen, MessageCircle, Plus, Trash2, Undo2, Upload } from '@lucide/svelte';
 import { CHARACTER_FIELDS, characterCard, characterDraft, emptyCharacterDraft, generatedCharacterCard, validateCharacterDraft, type CharacterDraft, type CharacterField } from '../../shared/character-draft';
 import type { Character, JsonObject } from '../../shared/types';
 import { avatarImage, MAX_AVATAR_BYTES } from '../../shared/avatar';
 import Avatar from './Avatar.svelte';
 import type { Api, CharacterImageDrafts } from './api';
 import { imageUrl } from '@hasbai/images';
 let { api, character, onsave, oncancel, actions }: { api: Api; character?: Character; onsave: (card: JsonObject, images?: CharacterImageDrafts, startChat?: boolean) => Promise<void>; oncancel: () => void; actions?: Snippet } = $props();
 const original = untrack(() => $state.snapshot(character?.card));
 let draft = $state<CharacterDraft>(untrack(() => original ? characterDraft(original) : emptyCharacterDraft())), brief = $state(''), tagText = $state(untrack(() => draft.tags.join('，')));
 let images = $state<CharacterImageDrafts>({}), previews = $state<Record<string,string>>({}), imagePrompt = $state(''), generatingImage = $state<'avatar'|'portrait'>(), uploadingImage = $state(false);
 const imageKinds = [{kind:'avatar' as const,label:'头像'},{kind:'portrait' as const,label:'立绘'}];
 let generating = $state(false), saving = $state(false), error = $state(''), status = $state('');
 let previous = $state<CharacterDraft>(), previousTags = $state('');
 let controller: AbortController | undefined;
 const locked = $derived(generating || !!generatingImage || uploadingImage || saving);
 const canGenerate = $derived([brief, draft.name, draft.description, draft.personality, draft.scenario, draft.first_mes, draft.mes_example].some(text => text.trim()));
 onDestroy(() => controller?.abort());
 $effect(() => {const current=$state.snapshot(images),urls:Record<string,string>={};for(const {kind} of imageKinds){const image=current[kind];if(image)urls[kind]=image instanceof File?URL.createObjectURL(image):image.url;}previews=urls;return()=>{for(const url of Object.values(urls))if(url.startsWith('blob:'))URL.revokeObjectURL(url);};});
 async function uploadImage(event:Event,kind:'avatar'|'portrait') {
  const input=event.currentTarget as HTMLInputElement,file=input.files?.[0];if(!file||locked)return;
  error='';uploadingImage=true;const active=new AbortController();controller=active;
  try{if(file.size>MAX_AVATAR_BYTES)throw Error('图片不能超过 5 MB');const image=avatarImage(new Uint8Array(await file.arrayBuffer()));if(!active.signal.aborted)images={...images,[kind]:new File([file],file.name,{type:image.type})};}
  catch(e){if(!active.signal.aborted)error=(e as Error).message;}finally{input.value='';uploadingImage=false;}
 }
 async function generateImage(kind:'avatar'|'portrait') {
  if(locked)return;error='';const active=new AbortController();controller=active;generatingImage=kind;
  try{const prompt=imagePrompt.trim()||[draft.name,draft.description,draft.personality,draft.scenario].filter(Boolean).join('，').slice(0,1800);const image=await api.imageDraft(kind,prompt,active.signal);if(!active.signal.aborted&&controller===active)images={...images,[kind]:image};}
  catch(e){if(!active.signal.aborted)error=(e as Error).message;}finally{generatingImage=undefined;}
 }
 function snapshot() {
  return validateCharacterDraft({ ...$state.snapshot(draft), tags: tagText === draft.tags.join('，') ? [...draft.tags] : tagText.split(/[,，、\n]/).map(tag => tag.trim()).filter(Boolean) });
 }
 async function generate() {
  if (locked) return;
  error = ''; status = '';
  try {
   const input = snapshot();
   generating = true; const active = new AbortController(); controller = active;
   const result = await api.request<{ card: JsonObject }>('characters/generate', 'POST', { brief, draft: input }, active.signal);
   if (active.signal.aborted || controller !== active) return;
   const card = generatedCharacterCard(result.card);
   const { extensions: _extensions, ...data } = card.data as JsonObject;
   previous = input; previousTags = tagText; draft = validateCharacterDraft(data); tagText = draft.tags.join('，');
   status = '已生成';
  } catch (e) { if (!controller?.signal.aborted) error = e instanceof Error ? e.message : '生成失败，请重试'; }
  finally { generating = false; }
 }
 function undo() { if (!previous || locked) return; draft = previous; tagText = previousTags; previous = undefined; status = '已撤销生成'; error = ''; }
 async function save(event?: SubmitEvent, startChat = false) {
  event?.preventDefault(); if (locked) return;
  error = ''; status = '';
  try {
   const input = snapshot();
   if (!input.name.trim()) { error = '请填写角色名称'; return; }
   saving = true; await onsave(characterCard(input, original), images, startChat);
  } catch (e) { error = e instanceof Error ? e.message : '保存失败，请重试'; }
  finally { saving = false; }
 }
 const sections: { title: string; icon: typeof UserRound; fields: CharacterField[] }[] = [
  { title: '人物设定', icon: BookOpen, fields: ['description', 'personality', 'scenario'] },
  { title: '开场与对白', icon: MessageCircle, fields: ['first_mes', 'mes_example'] },
 ];
 trackLoading(()=>locked);
</script>

<Dialog.Header>
 <Dialog.Title class="creator-title">{character?.name ?? '创建角色'}</Dialog.Title>
</Dialog.Header>
 {#if status}<div class="creator-feedback" role="status"><span class="creator-result">{#if status==='已生成'}<Check size={16} aria-hidden="true"/>{:else}<Undo2 size={16} aria-hidden="true"/>{/if}<span class="sr-only">{status}</span></span>{#if previous}<Button type="button" variant="ghost" onclick={undo} disabled={locked}><Undo2 size={16} aria-hidden="true"/>撤销生成</Button>{/if}</div>{/if}
 {#if error}<Notice variant="error">{error}</Notice>{/if}
<form id="character-form" class="creator-scroll" onsubmit={save}>
 <section class="creator-ai">
  <label class="sr-only" for="character-brief">角色构想</label>
  <textarea id="character-brief" rows="2" bind:value={brief} disabled={locked} placeholder="角色构想"></textarea>
  <div class="creator-ai-actions"><Button type="button" variant="outline" onclick={generate} disabled={locked || !canGenerate}><span aria-hidden="true">{#if generating}<Spinner/>{:else}<Sparkles size={16}/>{/if}</span>AI 生成</Button></div>
 </section>
 <fieldset disabled={locked} class="creator-fields">
  <section class="creator-section">
   <div class="creator-section-heading"><UserRound size={18} aria-hidden="true"/><h2>基本信息</h2></div>
   <div class="creator-identity">
    <div class="creator-avatar">{#if previews.avatar}<img src={previews.avatar} alt="角色头像" width="80" height="80"/>{:else if character}<Avatar {api} id={character.id} name={character.name} available={character.hasAvatar}/>{:else}<UserRound size={28} aria-hidden="true"/>{/if}</div>
    <div class="field"><label for="character-name">角色名称</label><Input id="character-name" bind:value={draft.name}/></div>
   </div>
   <div class="creator-images">
    {#each imageKinds as {kind,label}}
     <section class="creator-image"><h3>{label}</h3>
      {#if kind==='portrait'}<div class="creator-portrait">{#if previews.portrait||character?.portraitImageId}<img src={previews.portrait||imageUrl(character!.portraitImageId!)} alt="角色立绘"/>{:else}<span>尚无立绘</span>{/if}</div>{/if}
      <div class="creator-avatar-actions"><label class="image-upload"><Upload size={16} aria-hidden="true"/>上传{label}<input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`上传${label}`} onchange={event=>uploadImage(event,kind)}/></label><Button type="button" variant="outline" disabled={locked||![imagePrompt,draft.name,draft.description].some(text=>text.trim())} onclick={()=>generateImage(kind)}><span aria-hidden="true">{#if generatingImage===kind}<Spinner/>{:else}<Sparkles size={16}/>{/if}</span>AI 生成{label}</Button>{#if images[kind]}<Button type="button" variant="ghost" onclick={()=>images={...images,[kind]:undefined}}>撤销{label}</Button>{/if}</div>
     </section>
    {/each}
   </div>
   <div class="field"><label for="image-prompt">图片描述</label><Input id="image-prompt" bind:value={imagePrompt} maxlength={1800} placeholder="留空时使用人物设定"/></div>
   <div class="field"><label for="character-tags">标签</label><Input id="character-tags" bind:value={tagText}/></div>
  </section>
  {#each sections as section}
   <section class="creator-section"><div class="creator-section-heading"><section.icon size={18} aria-hidden="true"/><h2>{section.title}</h2></div>
    {#each section.fields as key}<div class="field"><label for={`character-${key}`}>{CHARACTER_FIELDS[key].label}</label><textarea id={`character-${key}`} bind:value={draft[key]} rows={key === 'description' || key === 'first_mes' ? 4 : 3}></textarea></div>{/each}
    {#if section.title === '开场与对白'}
     <div class="creator-alternates"><div class="creator-section-heading"><h3>备选开场白</h3><Button type="button" variant="ghost" onclick={() => draft.alternate_greetings = [...draft.alternate_greetings, '']}><Plus size={16} aria-hidden="true"/>添加</Button></div>
      {#each draft.alternate_greetings as _, i}<div class="creator-alternate"><label class="sr-only" for={`character-greeting-${i}`}>备选开场白 {i+1}</label><textarea id={`character-greeting-${i}`} bind:value={draft.alternate_greetings[i]} rows="3"></textarea><Button type="button" variant="ghost" aria-label={`删除备选开场白 ${i+1}`} onclick={() => draft.alternate_greetings = draft.alternate_greetings.filter((_, index) => index !== i)}><Trash2 size={16}/></Button></div>{/each}
     </div>
    {/if}
   </section>
  {/each}
  <details class="creator-advanced"><summary>作者与高级设定</summary><div class="creator-section"><div class="creator-two-fields">{#each ['creator', 'character_version'] as key}<div class="field"><label for={`character-${key}`}>{CHARACTER_FIELDS[key as CharacterField].label}</label><Input id={`character-${key}`} bind:value={draft[key as CharacterField]}/></div>{/each}</div>{#each ['creator_notes', 'system_prompt', 'post_history_instructions'] as key}<div class="field"><label for={`character-${key}`}>{CHARACTER_FIELDS[key as CharacterField].label}</label><textarea id={`character-${key}`} bind:value={draft[key as CharacterField]} rows="3"></textarea></div>{/each}</div></details>
 </fieldset>

 {#if actions}<fieldset disabled={locked} class="creator-tools">{@render actions()}</fieldset>{/if}
 {#if character?.sourceUrl}<a href={character.sourceUrl} target="_blank" rel="noopener noreferrer">角色来源</a>{/if}
 {#if character?.unsupported.length}<div class="tags"><span>扩展仅保留</span>{#each character.unsupported as item}<span>{item}</span>{/each}</div>{/if}
</form>
<Dialog.Footer class="creator-footer"><div class="actions"><Button type="button" variant="outline" disabled={saving} onclick={oncancel}>{generating || generatingImage ? '取消生成并关闭' : '取消'}</Button>{#if character}<Button type="button" variant="outline" disabled={locked} onclick={() => save(undefined, true)}>开始对话</Button>{/if}<Button type="submit" form="character-form" disabled={locked}>{#if saving}<Spinner/>{/if}保存角色</Button></div></Dialog.Footer>

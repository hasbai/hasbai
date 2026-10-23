<script lang="ts">
 import { Brain, SlidersHorizontal, Cpu, RotateCcw } from '@lucide/svelte';
 import { Button } from '@hasbai/ui/button';
 import { SAMPLING_TEMPLATES, type Settings, type ModelOption } from '../../shared/types';
 let { settings = $bindable(), models = [], disabled = false, scope = '新会话默认', id = 'generation' }: { settings: Settings; models?: ModelOption[]; disabled?: boolean; scope?: string; id?: string } = $props();
 function applyTemplate(thinkingEnabled:boolean){Object.assign(settings,{thinkingEnabled,...(thinkingEnabled?SAMPLING_TEMPLATES.thinking:SAMPLING_TEMPLATES.instruct),frequencyPenalty:0});}
 const unavailable = $derived(disabled);
</script>
<section class="settings-section model-section" aria-labelledby={`${id}-model-heading`}>
 <div class="section-heading"><div><Cpu size={18} aria-hidden="true"/><h2 id={`${id}-model-heading`}>模型</h2></div><span class="scope-badge">{scope}</span></div>
 <div class="field"><label for={`${id}-model`}>对话模型</label><select id={`${id}-model`} bind:value={settings.modelId} {disabled}><option value="rp">RP 动态路由</option></select></div>
 <div class="thinking-row"><div class="thinking-label"><Brain size={19} aria-hidden="true"/><label id={`${id}-thinking-label`} for={`${id}-thinking`}>启用思考</label></div><button type="button" class="thinking-switch" id={`${id}-thinking`} role="switch" aria-checked={settings.thinkingEnabled} aria-labelledby={`${id}-thinking-label`} disabled={unavailable} onclick={()=>applyTemplate(!settings.thinkingEnabled)}><span></span></button></div>
 <div class="field"><label for={`${id}-reasoning-effort`}>思考强度</label><select id={`${id}-reasoning-effort`} bind:value={settings.reasoningEffort} disabled={unavailable||!settings.thinkingEnabled}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></div>
</section>
<section class="settings-section" aria-labelledby={`${id}-params-heading`}>
 <div class="section-heading"><div><SlidersHorizontal size={18} aria-hidden="true"/><h2 id={`${id}-params-heading`}>生成参数</h2></div><Button type="button" variant="ghost" disabled={disabled} onclick={()=>applyTemplate(settings.thinkingEnabled)}><RotateCcw size={14} aria-hidden="true"/>恢复默认</Button></div>
 <div class="parameter-grid">
  <div class="field parameter-field"><label for={`${id}-temperature`}>温度</label><div class="range-field"><input type="range" min="0" max="2" step="0.05" bind:value={settings.temperature} aria-label="温度滑杆" disabled={unavailable}/><input id={`${id}-temperature`} type="number" min="0" max="2" step="0.05" bind:value={settings.temperature} required disabled={unavailable}/></div></div>
  <div class="field parameter-field"><label for={`${id}-top-p`}>Top P</label><div class="range-field"><input type="range" min="0.01" max="1" step="0.01" bind:value={settings.topP} aria-label="Top P 滑杆" disabled={unavailable}/><input id={`${id}-top-p`} type="number" min="0.01" max="1" step="0.01" bind:value={settings.topP} required disabled={unavailable}/></div></div>
  <div class="field parameter-field"><label for={`${id}-top-k`}>Top K {#if settings.topK===0}<span class="scope-badge">模型默认</span>{/if}</label><input id={`${id}-top-k`} type="number" min="0" max="1000" step="1" bind:value={settings.topK} required disabled={unavailable}/></div>
  <div class="field parameter-field"><label for={`${id}-min-p`}>Min P</label><input id={`${id}-min-p`} type="number" min="0" max="1" step="0.01" bind:value={settings.minP} required disabled={unavailable}/></div>
  <div class="field parameter-field"><label for={`${id}-repetition`}>重复惩罚</label><input id={`${id}-repetition`} type="number" min="0.01" max="2" step="0.01" bind:value={settings.repetitionPenalty} required disabled={unavailable}/></div>
  <div class="field parameter-field"><label for={`${id}-frequency`}>频率惩罚 </label><input id={`${id}-frequency`} type="number" min="-2" max="2" step="0.1" bind:value={settings.frequencyPenalty} required disabled={unavailable}/></div>
  <div class="field parameter-field"><label for={`${id}-presence`}>存在惩罚 </label><input id={`${id}-presence`} type="number" min="-2" max="2" step="0.1" bind:value={settings.presencePenalty} required disabled={unavailable}/></div>
 </div>
</section>

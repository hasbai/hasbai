<script lang="ts">
 import { Image } from '@lucide/svelte';
 import type { Settings } from '../../shared/types';
 let {settings=$bindable(),disabled=false,scope='新会话默认',id='appearance',hasPortrait=undefined}:{settings:Settings;disabled?:boolean;scope?:string;id?:string;hasPortrait?:boolean}=$props();
</script>
<section class="settings-section" aria-labelledby={`${id}-heading`}>
 <div class="section-heading"><div><Image size={18} aria-hidden="true"/><h2 id={`${id}-heading`}>对话背景</h2></div><span class="scope-badge">{scope}</span></div>
 <div class="appearance-toggle-row">
  <label class="appearance-toggle-label" for={`${id}-enabled`}>使用角色立绘</label>
  <input id={`${id}-enabled`} type="checkbox" role="switch" class="toggle-switch" bind:checked={settings.characterBackground} {disabled}/>
 </div>
 {#if hasPortrait===false&&settings.characterBackground}<p class="muted appearance-note">当前角色尚无立绘</p>{/if}
 <div class="field">
  <div class="range-label">
   <label for={`${id}-opacity`}>背景不透明度</label>
   <span class="range-value">{settings.backgroundOpacity}%</span>
  </div>
  <input id={`${id}-opacity`} class="range-slider" type="range" min="0" max="100" step="1" bind:value={settings.backgroundOpacity} disabled={disabled||!settings.characterBackground}/>
 </div>
</section>

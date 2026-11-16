<script lang="ts">
 import { Image } from '@lucide/svelte';
 import type { Settings } from '../../shared/types';
 let {settings=$bindable(),disabled=false,scope='新会话默认',id='appearance'}:{settings:Settings;disabled?:boolean;scope?:string;id?:string}=$props();
</script>
<section class="settings-section" aria-labelledby={`${id}-heading`}>
 <div class="section-heading"><div><Image size={18} aria-hidden="true"/><h2 id={`${id}-heading`}>对话背景</h2></div><span class="scope-badge">{scope}</span></div>
 <label class="checkbox-row"><input type="checkbox" bind:checked={settings.characterBackground} {disabled}/>使用角色立绘</label>
 <div class="field"><label for={`${id}-opacity`}>背景不透明度 <span>{settings.backgroundOpacity}%</span></label><input id={`${id}-opacity`} type="range" min="0" max="100" step="1" bind:value={settings.backgroundOpacity} disabled={disabled||!settings.characterBackground}/></div>
</section>

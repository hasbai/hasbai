<script lang="ts">
 import { ChevronRight, CircleCheck, LoaderCircle, CircleAlert, Wrench, Layers3, Clapperboard, MessageCircle, Info } from '@lucide/svelte';
 import type { AgentActivity } from '../../shared/types';
 let {activities}:{activities:AgentActivity[]}=$props();
 const labels={running:'运行中',completed:'已完成',error:'失败',stopped:'已停止'};
 const icons={body:MessageCircle,director:Clapperboard,tool:Wrench,compression:Layers3,status:Info};
 function format(value:unknown):string{if(typeof value==='string'){try{return JSON.stringify(JSON.parse(value),null,2);}catch{return value;}}return JSON.stringify(value,null,2)??'';}
</script>
{#if activities.length}<div class="agent-activities" aria-label="Agent 执行记录">
 {#each activities as activity(activity.id)}{@const Icon=icons[activity.kind]}
  <details class="agent-activity" data-status={activity.status}>
   <summary><ChevronRight class="activity-chevron" size={14} aria-hidden="true"/><Icon size={15} aria-hidden="true"/><span>{activity.title}</span><span class="activity-status">{#if activity.status==='running'}<LoaderCircle class="activity-spinner" size={13} aria-hidden="true"/>{:else if activity.status==='completed'}<CircleCheck size={13} aria-hidden="true"/>{:else}<CircleAlert size={13} aria-hidden="true"/>{/if}{labels[activity.status]}</span></summary>
   <div class="activity-result">{#if activity.input!==undefined}<h4>输入</h4><pre>{format(activity.input)}</pre>{/if}{#if activity.result!==undefined}<h4>结果</h4><pre>{format(activity.result)}</pre>{/if}{#if activity.error}<p role="status">{activity.error}</p>{:else if activity.status==='running'}<p role="status">等待执行结果…</p>{/if}</div>
  </details>
 {/each}
</div>{/if}

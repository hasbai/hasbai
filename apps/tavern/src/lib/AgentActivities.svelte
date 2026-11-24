<script lang="ts">
 import { ChevronRight, CircleCheck, LoaderCircle, CircleAlert, Wrench, Layers3, Clapperboard, MessageCircle, Info } from '@lucide/svelte';
 import type { AgentActivity, GenerationProgress } from '../../shared/types';
 let {activities,progress}:{activities:AgentActivity[];progress?:GenerationProgress}=$props();
 const phases={prefill:'处理中',reasoning:'思考中',generation:'生成中'};
 let visible=$derived(activities.filter(activity=>activity.kind!=='body'&&!(progress?.target==='director'&&activity.kind==='director'&&activity.status==='running')));
 const labels={running:'运行中',completed:'已完成',error:'失败',stopped:'已停止'};
 const icons={body:MessageCircle,director:Clapperboard,tool:Wrench,compression:Layers3,status:Info};
 function format(value:unknown):string{if(typeof value==='string'){try{return JSON.stringify(JSON.parse(value),null,2);}catch{return value;}}return JSON.stringify(value,null,2)??'';}
 function hasDetails(activity:AgentActivity):boolean{return activity.input!==undefined||activity.result!==undefined||!!activity.error;}
</script>
{#if visible.length||progress}<div class="agent-activities" aria-label="Agent 执行记录">
 {#each visible as activity(activity.id)}{@const Icon=icons[activity.kind]}
 {#if activity.kind==='compression'}
  <div class="agent-activity" data-kind="compression" data-status={activity.status}>
   <div class="activity-line" role="status"><Layers3 size={15} aria-hidden="true"/><span>{activity.title}</span><span class="activity-status">{#if activity.status==='running'}<LoaderCircle class="activity-spinner" size={13} aria-hidden="true"/>{:else if activity.status==='completed'}<CircleCheck size={13} aria-hidden="true"/>{:else}<CircleAlert size={13} aria-hidden="true"/>{/if}<span class="sr-only">{labels[activity.status]}</span></span></div>
   {#if activity.error}<p class="activity-error" role="status">{activity.error}</p>{/if}
  </div>
 {:else if !hasDetails(activity)}
  <div class="agent-activity" data-status={activity.status}>
   <div class="activity-line"><Icon size={15} aria-hidden="true"/><span>{activity.title}</span><span class="activity-status">{#if activity.status==='running'}<LoaderCircle class="activity-spinner" size={13} aria-hidden="true"/>{:else if activity.status==='completed'}<CircleCheck size={13} aria-hidden="true"/>{:else}<CircleAlert size={13} aria-hidden="true"/>{/if}<span class="sr-only">{labels[activity.status]}</span></span></div>
  </div>
 {:else}
  <details class="agent-activity" data-status={activity.status}>
   <summary><ChevronRight class="activity-chevron" size={14} aria-hidden="true"/><Icon size={15} aria-hidden="true"/><span>{activity.title}</span><span class="activity-status">{#if activity.status==='running'}<LoaderCircle class="activity-spinner" size={13} aria-hidden="true"/>{:else if activity.status==='completed'}<CircleCheck size={13} aria-hidden="true"/>{:else}<CircleAlert size={13} aria-hidden="true"/>{/if}<span class="sr-only">{labels[activity.status]}</span></span></summary>
   <div class="activity-result">{#if activity.input!==undefined}<h4>输入</h4><pre>{format(activity.input)}</pre>{/if}{#if activity.result!==undefined}<h4>结果</h4><pre>{format(activity.result)}</pre>{/if}{#if activity.error}<p role="status">{activity.error}</p>{:else if activity.status==='running'}<span role="status" aria-label="等待执行结果"><LoaderCircle class="activity-spinner" size={16} aria-hidden="true"/></span>{/if}</div>
  </details>
 {/if}
 {/each}
 {#if progress}
  {#if progress.reasoning}
   <details class="agent-activity" data-status="running" data-phase={progress.phase}>
    <summary><ChevronRight class="activity-chevron" size={14} aria-hidden="true"/><LoaderCircle class="activity-spinner" size={15} aria-hidden="true"/><span role="status">{phases[progress.phase]}</span>{#if progress.target==='director'}<span class="activity-status">Director</span>{/if}</summary>
    <div class="activity-result"><pre aria-label="思考过程">{progress.reasoning}</pre></div>
   </details>
  {:else}
   <div class="agent-activity" data-status="running" data-phase={progress.phase}>
    <div class="activity-line"><LoaderCircle class="activity-spinner" size={15} aria-hidden="true"/><span role="status">{phases[progress.phase]}</span>{#if progress.target==='director'}<span class="activity-status">Director</span>{/if}</div>
   </div>
  {/if}
 {/if}
</div>{/if}

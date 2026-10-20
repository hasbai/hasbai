<script lang="ts">
  import { Skeleton } from '@hasbai/ui/progress';
  let { layout = 'form' }: { layout?: 'cards' | 'form' | 'list' } = $props();
</script>

<div class:card-grid={layout==='cards'} class="loading-placeholder" aria-hidden="true">
  {#each Array(layout==='form'?2:3) as _}
    <div class:character-card={layout==='cards'} class="loading-block">
      {#if layout==='cards'}<Skeleton width="64px" height="64px"/>{/if}
      <Skeleton width="55%" height="18px"/>
      <Skeleton height={layout==='form'?'100px':'14px'}/>
      <Skeleton width="75%" height="14px"/>
    </div>
  {/each}
</div>

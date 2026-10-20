<script lang="ts">
  let { active }: { active: boolean } = $props();
</script>

{#if active}
  <div class="loading-bar" role="progressbar" aria-label="加载进度" aria-valuetext="进行中">
    <span></span>
  </div>
{/if}

<style>
  .loading-bar{position:fixed;inset:0 0 auto;height:3px;z-index:1000;pointer-events:none;overflow:hidden;background:color-mix(in srgb,var(--foreground) 12%,transparent)}
  span{display:block;width:36%;height:100%;background:var(--foreground);animation:progress 1.2s ease-in-out infinite}
  @keyframes progress{from{transform:translateX(-100%)}to{transform:translateX(380%)}}
  @media(prefers-reduced-motion:reduce){span{animation:none;width:100%}}
</style>

<script lang="ts">
  let { width = '100%', height = '1em' }: { width?: string; height?: string } = $props();
</script>
<div class="skeleton" style:width style:height aria-hidden="true"></div>
<style>
  .skeleton{max-width:100%;border-radius:8px;background:var(--muted);animation:pulse 1.6s ease-in-out infinite}
  @keyframes pulse{50%{opacity:.45}}
  @media(prefers-reduced-motion:reduce){.skeleton{animation:none}}
</style>

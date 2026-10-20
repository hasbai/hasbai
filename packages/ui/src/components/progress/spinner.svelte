<script lang="ts">
  import { LoaderCircle } from '@lucide/svelte';
  let { size = 16 }: { size?: number } = $props();
</script>
<span class="spinner" aria-hidden="true"><LoaderCircle {size}/></span>
<style>
  .spinner{display:inline-flex;flex-shrink:0;animation:spin 1s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  @media(prefers-reduced-motion:reduce){.spinner{animation:none}}
</style>

<script lang="ts">
  import { X } from "@lucide/svelte";
  import Notice from "./notice.svelte";
  import { useNotifications } from "./notification-context.svelte.js";
  let { label, closeLabel }: { label: string; closeLabel: string } = $props();
  const notifications = useNotifications();
  let hovered = $state.raw<typeof notifications.current>(null);
  let focused = $state.raw<typeof notifications.current>(null);
  $effect(() => {
    const message = notifications.current;
    if (!message || hovered === message || focused === message || message.variant === "error" || message.variant === "warning") return;
    const timer = setTimeout(() => notifications.dismiss(), 5000);
    return () => clearTimeout(timer);
  });
</script>

{#if notifications.current}
  <section class="notifications" aria-label={label}
    onpointerenter={() => hovered = notifications.current} onpointerleave={() => hovered = null}
    onfocusin={() => focused = notifications.current} onfocusout={() => focused = null}>
    <Notice variant={notifications.current.variant}>
      <div class="notification-content">
        <span>{notifications.current.text}</span>
        <button type="button" aria-label={closeLabel} onclick={notifications.dismiss}><X size={18} /></button>
      </div>
    </Notice>
  </section>
{/if}

<style>
  .notifications { position: fixed; z-index: 100; bottom: calc(var(--notification-bottom, 1rem) + env(safe-area-inset-bottom, 0px)); right: max(1rem, env(safe-area-inset-right)); width: min(26rem, calc(100vw - 2rem)); border-radius: .5rem; background: var(--background); box-shadow: 0 8px 32px #0002; }
  .notification-content { display: flex; align-items: start; gap: .75rem; }
  .notification-content span { flex: 1; overflow-wrap: anywhere; }
  button { display: grid; place-items: center; flex: 0 0 44px; width: 44px; height: 44px; margin: -.5rem -.5rem -.5rem 0; border-radius: .25rem; }
  button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
</style>

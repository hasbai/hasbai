import { getContext, setContext } from "svelte";

type Variant = "info" | "error" | "warning" | "success";
const key = Symbol("notifications");
export function createNotifications() {
  let current = $state.raw<{ text: string; variant: Variant } | null>(null);
  const notifications = {
    get current() { return current; },
    show(text: string, variant: Variant = "info") {
      const message = { text, variant };
      current = message;
      return () => { if (current === message) current = null; };
    },
    dismiss() { current = null; },
  };
  setContext(key, notifications);
  return notifications;
}
export function useNotifications() {
  return getContext<ReturnType<typeof createNotifications>>(key);
}

import { getContext, setContext, untrack } from 'svelte';

const key = Symbol('loading-progress');

export function createLoadingProgress() {
  let pending = $state(0);
  const progress = {
    get active() { return pending > 0; },
    begin() {
      untrack(() => pending++);
      return () => untrack(() => pending--);
    },
  };
  setContext(key, progress);
  return progress;
}

/** Register component activity; effect cleanup also releases unmounted tasks. */
export function trackLoading(active: () => boolean) {
  const progress = getContext<ReturnType<typeof createLoadingProgress>>(key);
  $effect(() => {
    if (active()) return progress.begin();
  });
}

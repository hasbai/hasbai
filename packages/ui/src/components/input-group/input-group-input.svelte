<script lang="ts">
  import { Input } from "@hasbai/ui/input/index.js";
  import { cn } from "@hasbai/ui/utils";
  import type { ComponentProps } from "svelte";

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    ...props
  }: ComponentProps<typeof Input> = $props();
</script>

<Input
  bind:ref
  data-slot="input-group-control"
  class={cn(
    "rounded-none border-0 bg-transparent shadow-none ring-0 dark:bg-transparent flex-1",
    className,
  )}
  bind:value
  {...props}
/>

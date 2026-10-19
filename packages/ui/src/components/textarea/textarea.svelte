<script lang="ts">
  import {
    cn,
    type WithElementRef,
    type WithoutChildren,
  } from "@hasbai/ui/utils";
  import type { HTMLTextareaAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    "data-slot": dataSlot = "textarea",
    ...restProps
  }: WithoutChildren<WithElementRef<HTMLTextareaAttributes>> = $props();
</script>

<textarea
  bind:this={ref}
  data-slot={dataSlot}
  class={cn(
    "bg-input/50 border-transparent focus-visible:border-ring aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 resize-none rounded-2xl border px-3 py-3 text-base transition-[color,box-shadow,background-color] md:text-sm flex field-sizing-content min-h-16 w-full placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
    className,
  )}
  bind:value
  {...restProps}></textarea>

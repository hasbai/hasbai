<script lang="ts">
  import { Command as CommandPrimitive } from "bits-ui";
  import { SparklesIcon } from "@lucide/svelte";
  import * as Command from "@hasbai/ui/command";
  import { cn } from "@hasbai/ui/utils";
  import { DEFAULT_PROVIDER, formatContext, groupModels, providerOf, type PickerModel } from "./group";

  let {
    models,
    value = $bindable(""),
    id,
    label = "对话模型",
    disabled = false,
    class: className,
    onchange,
  }: {
    models: PickerModel[];
    value?: string;
    id?: string;
    label?: string;
    disabled?: boolean;
    class?: string;
    onchange?: (id: string) => void;
  } = $props();

  let query = $state("");
  let highlight = $state("");
  let list = $state<HTMLElement | null>(null);
  // Filtering and order stay with Svelte: bits-ui would reorder DOM nodes while searching and never restore them.
  const groups = $derived(groupModels(models, query));
  const providerCount = $derived(new Set(models.map(providerOf).filter((provider) => provider !== DEFAULT_PROVIDER)).size);
  const keyOf = (model: PickerModel) => `${providerOf(model)} ${model.name} ${model.id}`;
  const hue = (name: string) => [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);

  // bits-ui reads the bound highlight only when the list mounts, so set it before the DOM update.
  $effect.pre(() => {
    const chosen = models.find((model) => model.id === value);
    highlight = chosen ? keyOf(chosen) : "";
  });
  // Bring the chosen model into view inside the list only; re-run when the list is (re)built, not on every pick.
  $effect(() => {
    void models.length;
    const box = list;
    if (!box) return;
    const target = box.querySelector<HTMLElement>('[data-checked="true"]');
    if (target) box.scrollTop = Math.max(0, target.offsetTop - box.clientHeight / 2 + target.clientHeight / 2);
  });
  function choose(model: PickerModel) {
    if (disabled || model.available === false) return;
    value = model.id;
    onchange?.(model.id);
  }
</script>

<!-- Callers mount with the full list or start empty; the key rebuilds once the first models arrive so the highlight starts on the chosen one. -->
{#key models.length > 0}
<Command.Root
  shouldFilter={false}
  disableInitialScroll
  bind:value={highlight}
  class={cn("border-input bg-card rounded-2xl border p-0", disabled && "pointer-events-none opacity-60", className)}
  aria-disabled={disabled}
>
  <Command.Input
    {id}
    bind:value={query}
    class="min-h-0! rounded-none! border-0! bg-transparent! p-0! text-sm! shadow-none!"
    aria-label={label}
    placeholder={`搜索 ${providerCount} 个 Provider 的模型`}
    {disabled}
    autofocus={false}
  />
  <Command.List bind:ref={list} class="relative max-h-[22rem] scroll-pt-9 px-1 pb-1 pt-1">
    {#if !groups.length}<div class="text-muted-foreground py-6 text-center text-sm">没有匹配的模型</div>{/if}
    {#each groups as group (group.key)}
      <Command.Group class="overflow-visible p-0 pb-1">
        <CommandPrimitive.GroupHeading class="bg-card/95 sticky top-0 z-10 flex items-center gap-2 px-2.5 py-2 backdrop-blur-sm">
          <span
            class="grid size-5 shrink-0 place-items-center rounded-md bg-[hsl(var(--h)_70%_50%/.16)] text-[10px] font-semibold uppercase text-[hsl(var(--h)_60%_35%)] dark:text-[hsl(var(--h)_75%_72%)]"
            style:--h={hue(group.provider)}
            aria-hidden="true"
          >
            {#if group.provider === DEFAULT_PROVIDER}<SparklesIcon class="size-3" />{:else}{group.provider.slice(0, 1)}{/if}
          </span>
          <span class="text-foreground text-xs font-semibold">{group.provider}</span>
          {#if group.vendor}<span class="text-muted-foreground text-xs">/ {group.vendor}</span>{/if}
          <span class="text-muted-foreground ml-auto text-[11px] tabular-nums">{group.models.length}</span>
        </CommandPrimitive.GroupHeading>
        {#each group.models as model (model.id)}
          {@const active = model.id === value}
          <Command.Item
            value={keyOf(model)}
            disabled={model.available === false}
            aria-checked={active}
            data-checked={active}
            onSelect={() => choose(model)}
            class={cn("min-h-11 pl-9", active && "bg-muted text-foreground")}
          >
            <span class="min-w-0 flex-1 truncate">{model.short}</span>
            {#if model.available === false}<span class="text-muted-foreground shrink-0 text-xs">不可用</span>{/if}
            {#if formatContext(model.contextTokens)}
              <span class="text-muted-foreground bg-muted shrink-0 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums">{formatContext(model.contextTokens)}</span>
            {/if}
          </Command.Item>
        {/each}
      </Command.Group>
    {/each}
  </Command.List>
</Command.Root>
{/key}

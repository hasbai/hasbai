<script lang="ts">
  import { keepFocusVisible } from "$lib/keep-focus-visible";
  import { createMutation, useQueryClient } from "@tanstack/svelte-query";
  import { ArrowLeft, Plus, ChevronRight, Trash2 } from "@lucide/svelte";
  import { Button } from "@hasbai/ui/button";
  import { Badge } from "@hasbai/ui/badge";
  import * as Dialog from "@hasbai/ui/dialog";
  import { useApi, useAccounts } from "$lib/context";
  import { errorMessage } from "$lib/api";
  import { accountIdError, accountGroups } from "$lib/accounts";
  import type { Account } from "$lib/types";
  import Field from "../components/Field.svelte";
  import AccountFields from "../components/AccountFields.svelte";
  import Notice from "../components/Notice.svelte";
  import Loading from "../components/Loading.svelte";
  import Failure from "../components/Failure.svelte";
  import Empty from "../components/Empty.svelte";
  const query = useAccounts();
  const api = useApi();
  const cache = useQueryClient();
  let search = $state("");
  let returnFocus: HTMLElement | null = null;
  let editing = $state<Partial<Account> | null>(null);
  let originalId = $state<number | null>(null);
  let id = $state("");
  let validation = $state("");
  let uncertain = $state(false);
  let open = $derived(editing !== null);
  async function updated() {
    editing = null;
    await cache.invalidateQueries();
  }
  function failed(e: Error) {
    uncertain = /fetch|network|timeout|Failed|Load failed/i.test(e.message);
  }
  const save = createMutation(() => ({
    mutationFn: () =>
      api.saveAccount(originalId, { ...editing, id: Number(id) }),
    onSuccess: updated,
    onError: failed,
  }));
  const remove = createMutation(() => ({
    mutationFn: () => api.deleteAccount(originalId!),
    onSuccess: updated,
    onError: failed,
  }));
  const busy = $derived(save.isPending || remove.isPending);
  let accounts = $derived(
    query.data?.filter((a) =>
      `${a.id}${a.type}${a.subtype}${a.name}`.includes(search.trim()),
    ) || [],
  );
  let groups = $derived(accountGroups(accounts));
  function edit(account: Partial<Account>) {
    returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    save.reset();
    remove.reset();
    originalId = account.id ?? null;
    id = account.id?.toString() ?? "";
    validation = "";
    uncertain = false;
    editing = { ...account };
  }
  function add() {
    edit({ type: "资产", name: "", subtype: "", notes: "" });
  }
</script>

<div class="page">
  <div class="page-heading pr-12">
    <div class="flex items-center gap-2">
      <Button href="/settings" variant="ghost" size="icon" aria-label="返回设置"
        ><ArrowLeft aria-hidden="true" /></Button
      >
      <h1>科目设置</h1>
    </div>
  </div>
  <Field label="搜索科目" type="search" bind:value={search} />
  {#if query.isPending}<Loading />{:else if query.error}<Failure
      error={query.error}
      retry={() => query.refetch()}
    />
  {:else if accounts.length === 0}<Empty title="没有匹配的科目"
      >{#if search.trim()}<Button
          variant="outline"
          onclick={() => (search = "")}>清空搜索</Button
        >{:else}<Button onclick={add}>新增科目</Button>{/if}</Empty
    >
  {:else}
    <div class="space-y-3">
      {#each groups as group (group.type)}
        <details
          class="group/category rounded-2xl border bg-card"
          open={search.trim() ? true : undefined}
        >
          <summary
            class="flex min-h-14 cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden"
          >
            <ChevronRight
              class="size-5 shrink-0 transition-transform group-open/category:rotate-90"
              aria-hidden="true"
            />
            <span class="font-mono text-muted-foreground">{group.code}</span>
            <span class="flex-1 font-semibold">{group.type}</span><Badge
              variant="secondary">{group.count}</Badge
            >
          </summary>
          <div class="space-y-2 border-t p-3">
            {#each group.subtypes as subtype (subtype.name)}
              <details
                class="group/subtype rounded-xl bg-muted/40"
                open={search.trim() ? true : undefined}
              >
                <summary
                  class="flex min-h-14 cursor-pointer list-none items-center gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden"
                >
                  <ChevronRight
                    class="size-4 shrink-0 transition-transform group-open/subtype:rotate-90"
                    aria-hidden="true"
                  />
                  <span class="font-mono text-sm text-muted-foreground"
                    >{subtype.prefix}</span
                  >
                  <span class="min-w-0 flex-1 font-medium wrap-anywhere"
                    >{subtype.name}</span
                  ><Badge variant="outline">{subtype.items.length}</Badge>
                </summary>
                <div class="divide-y border-t">
                  {#each subtype.items as account (account.id)}
                    <button
                      class="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted"
                      onclick={() => edit(account)}
                    >
                      <span class="font-mono text-sm text-muted-foreground"
                        >{account.id}</span
                      >
                      <span class="min-w-0 flex-1 wrap-anywhere"
                        >{account.name}</span
                      >
                      {#if account.type === "资产" && account.subtype === "现金及等价物"}<Badge
                          variant="outline">现金范围</Badge
                        >{/if}
                      <ChevronRight
                        class="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </button>
                  {/each}
                </div>
              </details>
            {/each}
          </div>
        </details>
      {/each}
    </div>
  {/if}
</div>
<Button
  onclick={add}
  aria-label="新增科目"
  disabled={query.isPending || !!query.error}
  class="mobile-create fixed right-5 bottom-[calc(88px+env(safe-area-inset-bottom))] z-20 h-16 w-16 rounded-full p-0 shadow-lg md:right-10 md:bottom-8"
  ><Plus class="size-7" aria-hidden="true" /></Button
>
<Dialog.Root
  {open}
  onOpenChange={(v) => {
    if (!v && !busy) editing = null;
  }}
>
  <Dialog.Content
    showCloseButton={false}
    class="form-sheet"
    onCloseAutoFocus={(event) => {
      event.preventDefault();
      returnFocus?.focus({ preventScroll: true });
    }}
    onEscapeKeydown={(e) => {
      if (busy) e.preventDefault();
    }}
    onInteractOutside={(e) => {
      if (busy) e.preventDefault();
    }}
  >
    <Dialog.Header
      class="form-sheet-header flex-row items-center justify-between text-left"
      ><Dialog.Title
        >{originalId !== null ? "修改科目" : "新增科目"}</Dialog.Title
      ><Dialog.Description class="sr-only">科目</Dialog.Description
      >{#if originalId !== null}<Button
          variant="ghost"
          size="icon"
          class="text-destructive"
          aria-label="删除科目"
          disabled={busy || uncertain}
          onclick={() => {
            if (window.confirm(`删除科目 ${originalId} ${editing?.name}？`))
              remove.mutate();
          }}><Trash2 aria-hidden="true" /></Button
        >{/if}</Dialog.Header
    >
    {#if editing}<form
        class="flex min-h-0 flex-col"
        onsubmit={(e) => {
          e.preventDefault();
          if (busy || uncertain) return;
          validation = accountIdError(
            id,
            editing!.type!,
            editing!.subtype || "",
            query.data || [],
            originalId,
          );
          if (!validation) save.mutate();
        }}
      >
        <div class="form-sheet-body space-y-4" use:keepFocusVisible>
          {#if validation}<Notice variant="error">{validation}</Notice>{/if}
          {#if save.error || remove.error}<Notice variant="error"
              >{errorMessage(save.error || remove.error)}</Notice
            >{/if}
          {#if uncertain}<Notice variant="warning"
              >操作待核对<Button
                variant="link"
                onclick={() => {
                  editing = null;
                  void cache.invalidateQueries();
                }}>查看科目</Button
              ></Notice
            >{/if}
          <fieldset disabled={busy || uncertain} class="min-w-0 space-y-4">
            <AccountFields
              bind:id
              bind:account={editing}
              disabled={busy || uncertain}
            />
          </fieldset>
        </div>
        <Dialog.Footer class="form-sheet-footer">
          <Button
            variant="outline"
            disabled={busy}
            onclick={() => (editing = null)}>取消</Button
          >
          <Button type="submit" disabled={busy || uncertain}
            >{save.isPending ? "正在保存…" : "保存科目"}</Button
          >
        </Dialog.Footer>
      </form>{/if}
  </Dialog.Content>
</Dialog.Root>

<script lang="ts">
  import { useNotifications } from "@hasbai/ui/notice";
  const notifications = useNotifications();
  import { getContext, onMount } from "svelte";
  import type { BlogAuth } from "$lib/auth.svelte";
  import { ui } from "$lib/i18n";
  import { languageName } from "$lib/locales";
  import { repository } from "$lib/api";
  import type { Tag } from "$lib/content";
  import { Button } from "@hasbai/ui/button";
  import { Input } from "@hasbai/ui/input";
  const t = ui();
  const auth = getContext<BlogAuth>("blog-auth");
  const api = repository(auth.token);
  let available = $state<string[]>([]);
  let locales = $state<string[]>([]);
  let busy = $state(false);
  let tags = $state<Tag[]>([]);
  let selected = $state("");
  let names = $state<Record<string, string>>({});
  async function request(method = "GET", value?: unknown) {
    const response = await fetch("/api/settings/locales", {
      method,
      headers: {
        Authorization: "Bearer " + (await auth.token()),
        "Content-Type": "application/json",
      },
      ...(value ? { body: JSON.stringify(value) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.message);
    return result;
  }
  onMount(() => {
    void (async () => {
      try {
        const config = await request();
        available = config.available;
        locales = config.locales;
        tags = await api.tags();
      } catch (e) {
        notifications.show(e instanceof Error ? t(e.message) : t("加载失败"), "error");
      }
    })();
  });
  async function save() {
    busy = true;
    try {
      await request("PUT", { locales });
      notifications.show(t("语言设置已保存"), "success");
    } catch (e) {
      notifications.show(e instanceof Error ? t(e.message) : t("保存失败"), "error");
    } finally {
      busy = false;
    }
  }
  function selectTag(id: string) {
    selected = id;
    names = { ...tags.find((tag) => tag.id === id)?.translations };
  }
  async function saveTag() {
    busy = true;
    try {
      const result = await api.db
        .from("tag")
        .update({ translations: Object.fromEntries(Object.entries(names).filter(([,name])=>!!name?.trim()).map(([locale,name])=>[locale,name.trim()])) })
        .eq("id", selected);
      if (result.error) throw Error(result.error.message);
      tags = await api.tags();
      notifications.show(t("已保存"), "success");
    } catch (e) {
      notifications.show(e instanceof Error ? t(e.message) : t("保存失败"), "error");
    } finally {
      busy = false;
    }
  }
</script>

<details class="my-6 rounded-xl border p-4">
  <summary class="cursor-pointer text-sm">{t("翻译设置")}</summary>
  <div class="mt-4 space-y-4">
    <fieldset>
      <legend class="mb-2 text-sm font-medium">{t("支持语言")}</legend>
      <div class="flex flex-wrap gap-4">
        {#each available as locale}<label
            class="flex min-h-11 items-center gap-2"
            ><input
              type="checkbox"
              value={locale}
              bind:group={locales}
              disabled={busy || locale === "zh-CN"}
            />{languageName(locale)}</label
          >{/each}
      </div>
    </fieldset>
    <Button
      variant="outline"
      disabled={busy || !available.length}
      onclick={save}>{t("保存")}</Button
    >
    {#if tags.length}<label class="field" for="localized-tag"
        >{t("标签")}
        <select
          id="localized-tag"
          class="min-h-11 rounded-md border bg-background px-2"
          value={selected}
          onchange={(e) => selectTag(e.currentTarget.value)}
          disabled={busy}
          ><option value="">—</option>{#each tags as tag}<option value={tag.id}
              >{tag.name}</option
            >{/each}</select
        >
      </label>{/if}
    {#if selected}<div class="grid gap-3 sm:grid-cols-3">
        {#each available as locale}<label class="field" for={"tag-" + locale}
            >{languageName(locale)}<Input
              id={"tag-" + locale}
              bind:value={names[locale]}
              maxlength={80}
              disabled={busy}
            /></label
          >{/each}
      </div>
      <Button
        variant="outline"
        disabled={busy || !names["zh-CN"]?.trim()}
        onclick={saveTag}>{t("保存")}</Button
      >{/if}
  </div>
</details>

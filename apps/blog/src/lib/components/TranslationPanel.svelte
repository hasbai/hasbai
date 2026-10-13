<script lang="ts">
  import { ui } from "$lib/i18n";
  import { languageName } from "$lib/locales";
  import type { Translation } from "$lib/content";
  import { Button } from "@hasbai/ui/button";
  const t = ui();
  let {
    locale,
    locales,
    translations,
    source = $bindable("zh-CN"),
    busy,
    dirty,
    change,
    translate,
  }: {
    locale: string;
    locales: string[];
    translations: Translation[];
    source: string;
    busy: boolean;
    dirty: boolean;
    change: (value: string) => boolean;
    translate: () => void;
  } = $props();
</script>

<div class="space-y-3 rounded-xl border p-4">
  <label class="field" for="content-locale"
    >{t("内容语言")}
    <select
      id="content-locale"
      class="min-h-11 rounded-md border bg-background px-2"
      value={locale}
      disabled={busy}
      onchange={(e) => {
        if (!change(e.currentTarget.value)) e.currentTarget.value = locale;
      }}
    >
      {#each locales as language}<option value={language}
          >{languageName(language)} · {translations.some(
            (v) => v.locale === language && !!v.markdown.trim(),
          )
            ? t("已翻译")
            : t("未翻译")}</option
        >{/each}
    </select>
  </label>
  {#if translations.length}
    <label class="field" for="translation-source"
      >{t("翻译来源")}
      <select
        id="translation-source"
        class="min-h-11 rounded-md border bg-background px-2"
        bind:value={source}
        disabled={busy}
      >
        {#each translations as translation}<option value={translation.locale}
            >{languageName(translation.locale)}</option
          >{/each}
      </select>
    </label>
  {/if}
  <Button
    variant="outline"
    disabled={busy || dirty || !translations.length || source === locale}
    onclick={translate}>{busy ? t("正在翻译…") : t("手动翻译")}</Button
  >
  {#if dirty}<p class="meta">{t("先保存修改再翻译")}</p>{/if}
</div>

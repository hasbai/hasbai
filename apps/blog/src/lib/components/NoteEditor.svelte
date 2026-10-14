<script lang="ts">
  import { Notice, useNotifications } from "@hasbai/ui/notice";
  const notifications = useNotifications();
  import { ui, links } from "$lib/i18n";
  const t = ui();
  const link = links();
  import { getContext, onMount } from "svelte";
  import { beforeNavigate, goto } from "$app/navigation";
  import type { BlogAuth } from "$lib/auth.svelte";
  import TranslationPanel from "./TranslationPanel.svelte";
  import { defaultLocales, localizedPath } from "$lib/locales";
  import type { Translation } from "$lib/content";
  import { repository } from "$lib/api";
  import {
    excerptFromMarkdown,
    site,
    imagePath,
    notePath,
    type Note,
  } from "$lib/content";
  import MarkdownEditor from "./MarkdownEditor.svelte";
  import { Button } from "@hasbai/ui/button";
  import { ArrowLeft, ImagePlus, X } from "@lucide/svelte";

  let { id }: { id?: string } = $props();
  const auth = getContext<BlogAuth>("blog-auth");
  const api = repository(auth.token);
  let locale = $state("zh-CN");
  let locales = $state<string[]>(defaultLocales);
  let translations = $state<Translation[]>([]);
  let source = $state("zh-CN");
  let translating = $state(false);
  let original = $state<Note>();
  let markdown = $state("");
  let coverId = $state<string | null>(null);
  let status = $state<"draft" | "published">("draft");
  let publishedAt = $state<string | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let uploading = $state(false);
  let error = $state("");
  let baseline = $state("");
  let deleting = $state(false);
  let coverInput = $state<HTMLInputElement>();
  const payload = () => ({
    locale,
    excerpt: excerptFromMarkdown(markdown),
    markdown,
    cover_id: coverId,
    status,
    published_at: publishedAt,
  });
  const dirty = $derived(!loading && baseline !== JSON.stringify(payload()));
  beforeNavigate(({ cancel }) => {
    if (
      (dirty || saving || uploading) &&
      !confirm(t("离开并放弃未保存的修改？"))
    )
      cancel();
  });
  function beforeUnload(event: BeforeUnloadEvent) {
    if (dirty || saving || uploading) {
      event.preventDefault();
      event.returnValue = "";
    }
  }
  async function load() {
    loading = true;
    error = "";
    try {
      locales = (await (await fetch("/api/locales")).json()).locales;
      if (id) {
        const note = await api.note(id);
        if (!note) throw new Error(t("手记不存在或无操作权限"));
        original = note;
        translations = await api.translations(note.id);
        source = note.source_locale ?? "zh-CN";
        locale = note.locale ?? source;
        markdown = note.markdown;
        coverId = note.cover_id;
        status = note.status;
        publishedAt = note.published_at;
      }
      baseline = JSON.stringify(payload());
    } catch (e) {
      error = e instanceof Error ? t(e.message) : t("加载失败");
    } finally {
      loading = false;
    }
  }
  onMount(() => {
    void load();
  });

  function changeLanguage(next: string, confirmed = false) {
    if (!confirmed && dirty && !confirm(t("离开并放弃未保存的修改？")))
      return false;
    coverId = original?.cover_id ?? null;
    status = original?.status ?? "draft";
    publishedAt = original?.published_at ?? null;
    locale = next;
    const version = translations.find((v) => v.locale === next);
    markdown = version?.markdown ?? "";
    baseline = JSON.stringify(payload());
    if (!version) notifications.show(t("缺少此语言的译文"));
    return true;
  }
  async function manualTranslate() {
    if (!original || dirty || translating) return;
    translating = true;
    error = "";
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + (await auth.token()),
        },
        body: JSON.stringify({
          id: original.id,
          updated_at: original.updated_at,
          source,
          target: locale,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || t("翻译失败"));
      original = { ...original, ...result.item };
      markdown=result.item.markdown;
      coverId = result.item.cover_id;
      status = result.item.status;
      publishedAt = result.item.published_at;
      translations = result.item.translations ?? [{content_id:original!.id,locale,title:result.item.title ?? "",excerpt:result.item.excerpt,markdown:result.item.markdown,updated_at:result.item.translation_updated_at}];
      changeLanguage(locale, true);
      notifications.show(t("翻译已保存"), "success");
    } catch (e) {
      notifications.show(e instanceof Error ? t(e.message) : t("翻译失败"), "error");
    } finally {
      translating = false;
    }
  }

  async function save(nextStatus: "draft" | "published") {
    if (saving || uploading || translating) return;
    saving = true;
    error = "";
    const previousStatus = status;
    const previousPublished = publishedAt;
    status = nextStatus;
    if (status === "published" && !publishedAt)
      publishedAt = new Date().toISOString();
    try {
      const note = await api.saveNote(
        payload(),
        original?.id,
        original?.updated_at,
      );
      original = note;
      markdown = note.markdown;
      coverId = note.cover_id;
      status = note.status;
      publishedAt = note.published_at;
      translations = note.translations ?? [{content_id:note.id,locale,title:"",excerpt:note.excerpt,markdown:note.markdown,updated_at:note.translation_updated_at ?? note.updated_at}];
      baseline = JSON.stringify(payload());
      notifications.show(
        original.translation_warning ? t(original.translation_warning) : status === "published" ? t("已发布") : t("草稿已保存"),
        original.translation_warning ? "warning" : "success",
      );
      saving = false;
      if (!id) await goto("/studio/notes/" + note.id, { replaceState: true });
    } catch (e) {
      status = previousStatus;
      publishedAt = previousPublished;
      notifications.show(e instanceof Error ? t(e.message) : t("保存失败"), "error");
    } finally {
      saving = false;
    }
  }
  async function uploadCover(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    uploading = true;
    error = "";
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error(t("图片不能超过 10 MB"));
      const response = await fetch("/api/images", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + (await auth.token()),
          "Content-Type": file.type,
          "X-Image-Name": encodeURIComponent(file.name),
        },
        body: file,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || t("上传失败"));
      coverId = result.id;
    } catch (e) {
      notifications.show(e instanceof Error ? t(e.message) : t("上传失败"), "error");
    } finally {
      uploading = false;
      if (coverInput) coverInput.value = "";
    }
  }
  async function remove() {
    if (!original || saving) return;
    saving = true;
    error = "";
    try {
      await api.remove("note", original.id, original.updated_at);
      baseline = JSON.stringify(payload());
      saving = false;
      await goto("/studio");
    } catch (e) {
      notifications.show(e instanceof Error ? t(e.message) : t("删除失败"), "error");
      saving = false;
    }
  }
</script>

<svelte:window onbeforeunload={beforeUnload} />
<svelte:head
  ><title
    >{original ? t("手记 №") + original.sequence : t("新手记")}
    {t("· 编辑室 ·")}
    {site.name}</title
  ></svelte:head
>
<section class="wrap editor-page py-8">
  <div class="flex flex-wrap items-center justify-between gap-4 pb-6">
    <Button variant="ghost" href={link("/studio")}
      ><ArrowLeft size={16} />{t("编辑室")}</Button
    >
    <div class="flex flex-wrap items-center gap-2">
      <span class="meta" role="status"
        >{saving
          ? t("正在保存…")
          : dirty
            ? t("未保存")
            : (status === "published" ? t("已发布") : t("草稿"))}</span
      >
      {#if original?.status === "published"}<Button
          variant="ghost"
          href={localizedPath(notePath(original), locale)}
          target="_blank">{t("查看")}</Button
        >{/if}
      <Button
        variant="outline"
        disabled={loading || saving || uploading || translating}
        onclick={() => save("draft")}
        >{status === "published" ? t("撤回为草稿") : t("保存草稿")}</Button
      >
      <Button
        disabled={loading || saving || uploading || translating}
        onclick={() => save("published")}
        >{status === "published" ? t("更新手记") : t("发布手记")}</Button
      >
    </div>
  </div>
  {#if loading}<div class="empty" role="status">{t("正在打开手记…")}</div>
  {:else if error && !baseline}<div class="empty">
      <Notice variant="error">{error}</Notice>
      <Button onclick={load}>{t("重试")}</Button>
    </div>
  {:else}
    <div
      class="grid items-start gap-12 py-8 lg:grid-cols-[minmax(0,1fr)_248px]"
    >
      <div class="min-w-0">
        <h1 class="serif mt-4 text-4xl">{t("手记")}</h1>
        <div class="mt-7">
          {#key locale}<MarkdownEditor
              bind:value={markdown}
              bind:busy={uploading}
              upload={async (file) => {
                if (file.size > 10 * 1024 * 1024)
                  throw new Error(t("图片不能超过 10 MB"));
                const response = await fetch("/api/images", {
                  method: "POST",
                  headers: {
                    Authorization: "Bearer " + (await auth.token()),
                    "Content-Type": file.type,
                    "X-Image-Name": encodeURIComponent(file.name),
                  },
                  body: file,
                });
                const result = await response.json();
                if (!response.ok)
                  throw new Error(result.message || t("上传失败"));
                return {
                  src: imagePath(result.id),
                  name: result.name,
                  id: result.id,
                };
              }}
              disabled={saving || translating}
            />{/key}
        </div>
      </div>
      <aside class="space-y-6 lg:sticky lg:top-8">
        <TranslationPanel
          {locale}
          {locales}
          {translations}
          bind:source
          busy={saving || uploading || translating}
          {dirty}
          change={changeLanguage}
          translate={manualTranslate}
        />
        <h2 class="serif text-xl">{t("出版信息")}</h2>
        <div class="field">
          <span class="text-sm font-medium">{t("封面")}</span>
          {#if coverId}<img
              class="cover"
              src={imagePath(coverId)}
              alt={t("手记封面")}
            /><Button
              variant="ghost"
              disabled={saving || translating}
              onclick={() => (coverId = null)}
              ><X size={16} />{t("移除封面")}</Button
            >{/if}
          <input
            bind:this={coverInput}
            type="file"
            class="hidden"
            accept="image/png,image/jpeg,image/webp,image/gif"
            aria-label={t("封面图片")}
            onchange={uploadCover}
          />
          <Button
            variant="outline"
            disabled={saving || uploading}
            onclick={() => coverInput?.click()}
            ><ImagePlus size={16} />{uploading
              ? t("正在上传…")
              : t("上传封面")}</Button
          >
        </div>
        {#if original}<div>
            {#if deleting}<p class="mb-3 text-sm">{t("删除这则手记？")}</p>
              <div class="flex gap-2">
                <Button
                  variant="destructive"
                  disabled={saving || translating}
                  onclick={remove}>{t("确认删除")}</Button
                ><Button
                  variant="ghost"
                  disabled={saving || translating}
                  onclick={() => (deleting = false)}>{t("取消")}</Button
                >
              </div>{:else}<Button
                variant="ghost"
                class="text-destructive"
                disabled={saving || translating}
                onclick={() => (deleting = true)}>{t("删除手记")}</Button
              >{/if}
          </div>{/if}
      </aside>
    </div>
  {/if}
</section>

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
    site,
    pageSlugSchema,
    pagePath,
    articlePath,
    imagePath,
    type Article,
    type Page,
    type Tag,
  } from "$lib/content";
  import MarkdownEditor from "./MarkdownEditor.svelte";
  import { Button } from "@hasbai/ui/button";
  import { Input } from "@hasbai/ui/input";
  import { Textarea } from "@hasbai/ui/textarea";
  import { ArrowLeft, ImagePlus, X } from "@lucide/svelte";
  let { id, kind = "article" }: { id?: string; kind?: "article" | "page" } =
    $props();
  const label = $derived(
    kind === "page" ? t("页面") : t("文章", { context: "singular" }),
  );
  const auth = getContext<BlogAuth>("blog-auth");
  const api = repository(auth.token);
  let locale = $state("zh-CN");
  let locales = $state<string[]>(defaultLocales);
  let translations = $state<Translation[]>([]);
  let source = $state("zh-CN");
  let translating = $state(false);
  let original = $state<Article | Page>();
  let title = $state("");
  let slug = $state("");
  let slugError = $state("");
  let excerpt = $state("");
  let markdown = $state("");
  let tagIds = $state<string[]>([]);
  let savedTagIds = $state<string[]>([]);
  let coverId = $state<string | null>(null);
  let status = $state<"draft" | "published">("draft");
  let publishedAt = $state<string | null>(null);
  let tags = $state<Tag[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let uploading = $state(false);
  let error = $state("");
  let baseline = $state("");
  let creatingTag = $state(false);
  let termName = $state("");
  let termSlug = $state("");
  let deleting = $state(false);
  let coverInput = $state<HTMLInputElement>();
  const payload = () => ({
    locale,
    title,
    slug,
    excerpt,
    markdown,
    tag_ids: tagIds,
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
      if (kind === "article") tags = await api.tags();
      locales = (await (await fetch("/api/locales")).json()).locales;
      if (id) {
        const article = await (kind === "page"
          ? api.page(id)
          : api.article(id));
        if (!article)
          throw new Error(t("{{kind}}不存在或无操作权限", { kind: label }));
        original = article;
        translations = await api.translations(article.id);
        source = article.source_locale ?? "zh-CN";
        locale = article.locale ?? source;
        title = article.title;
        slug = article.slug;
        excerpt = article.excerpt;
        markdown = article.markdown;
        if (kind === "article")
          tagIds = (await api.tagsForArticle(article.id)).map((tag) => tag.id);
        coverId = article.cover_id;
        status = article.status;
        publishedAt = article.published_at;
      }
      savedTagIds = [...tagIds];
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
    slug = original?.slug ?? "";
    tagIds = [...savedTagIds];
    locale = next;
    const version = translations.find((v) => v.locale === next);
    title = version?.title ?? "";
    excerpt = version?.excerpt ?? "";
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
      title=result.item.title;excerpt=result.item.excerpt;markdown=result.item.markdown;
      slug = result.item.slug;
      coverId = result.item.cover_id;
      status = result.item.status;
      publishedAt = result.item.published_at;
      tagIds = result.item.tag_ids ?? tagIds;
      savedTagIds = [...tagIds];
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
    slugError = "";
    if (kind === "page") {
      const checked = pageSlugSchema.safeParse(slug);
      if (!checked.success) {
        slugError = checked.error.issues[0].message;
        document.getElementById("slug")?.focus();
        return;
      }
    }
    saving = true;
    error = "";
    const previousStatus = status;
    const previousPublished = publishedAt;
    status = nextStatus;
    if (status === "published" && !publishedAt)
      publishedAt = new Date().toISOString();
    try {
      const article = await (kind === "page" ? api.savePage : api.saveArticle)(
        payload(),
        original?.id,
        original?.updated_at,
      );
      original = article;
      title = article.title;
      slug = article.slug;
      excerpt = article.excerpt;
      markdown = article.markdown;
      coverId = article.cover_id;
      status = article.status;
      publishedAt = article.published_at;
      tagIds = (article as Article & { tag_ids?: string[] }).tag_ids ?? tagIds;
      translations = article.translations ?? [{content_id:article.id,locale,title:(article as Article & {title?:string}).title ?? "",excerpt:article.excerpt,markdown:article.markdown,updated_at:article.translation_updated_at ?? article.updated_at}];
      savedTagIds = [...tagIds];
      baseline = JSON.stringify(payload());
      notifications.show(
        original.translation_warning ? t(original.translation_warning) : status === "published" ? t("已发布") : t("草稿已保存"),
        original.translation_warning ? "warning" : "success",
      );
      saving = false;
      if (!id)
        await goto(
          (kind === "page" ? "/studio/pages/" : "/studio/") + article.id,
          { replaceState: true },
        );
    } catch (e) {
      status = previousStatus;
      publishedAt = previousPublished;
      notifications.show(e instanceof Error ? t(e.message) : t("保存失败"), "error");
    } finally {
      saving = false;
    }
  }
  async function upload(file: File) {
    if (file.size > 10 * 1024 * 1024) throw new Error(t("图片不能超过 10 MB"));
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
    return { src: imagePath(result.id), name: result.name, id: result.id };
  }
  async function uploadCover(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    uploading = true;
    error = "";
    try {
      coverId = (await upload(file)).id;
    } catch (e) {
      notifications.show(e instanceof Error ? t(e.message) : t("上传失败"), "error");
    } finally {
      uploading = false;
      if (coverInput) coverInput.value = "";
    }
  }
  async function createTerm() {
    saving = true;
    error = "";
    try {
      const term = await api.createTag(termName, termSlug);
      tags = [...tags, term];
      tagIds = [...tagIds, term.id];
      creatingTag = false;
      termName = "";
      termSlug = "";
    } catch (e) {
      notifications.show(e instanceof Error ? t(e.message) : t("保存失败"), "error");
    } finally {
      saving = false;
    }
  }
  async function remove() {
    if (!original || saving) return;
    saving = true;
    error = "";
    try {
      await api.remove(kind, original.id, original.updated_at);
      savedTagIds = [...tagIds];
      baseline = JSON.stringify(payload());
      saving = false;
      await goto("/studio");
    } catch (e) {
      notifications.show(e instanceof Error ? t(e.message) : t("删除失败"), "error");
      saving = false;
    }
  }
</script>

<svelte:window onbeforeunload={beforeUnload} /><svelte:head
  ><title
    >{title || t("新{{kind}}", { kind: label })}
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
      >{#if original?.status === "published"}<Button
          variant="ghost"
          href={localizedPath(
            original.kind === "page"
              ? pagePath(original)
              : articlePath(original),
            locale,
          )}
          target="_blank">{t("查看")}</Button
        >{/if}<Button
        variant="outline"
        disabled={loading || saving || uploading || translating}
        onclick={() => save("draft")}
        >{status === "published" ? t("撤回为草稿") : t("保存草稿")}</Button
      ><Button
        disabled={loading || saving || uploading || translating}
        onclick={() => save("published")}
        >{status === "published"
          ? t("更新{{kind}}", { kind: label })
          : t("发布{{kind}}", { kind: label })}</Button
      >
    </div>
  </div>
  {#if loading}<div class="empty" role="status">
      {t("正在打开{{kind}}…",{kind:label})}
    </div>{:else if error && !baseline}<div class="empty">
      <Notice variant="error">{error}</Notice>
      <Button onclick={load}>{t("重试")}</Button>
    </div>{:else}
    <div
      class="grid items-start gap-12 py-8 lg:grid-cols-[minmax(0,1fr)_248px]"
    >
      <div class="min-w-0">
        <label for="article-title" class="sr-only">{t("标题")}</label><textarea
          id="article-title"
          class="serif min-h-30 w-full resize-y border-0 bg-transparent text-4xl leading-snug outline-none sm:text-5xl"
          placeholder={t("写下标题")}
          bind:value={title}
          disabled={saving || translating}
          maxlength="240"></textarea>
        <div class="mt-6">
          {#key locale}<MarkdownEditor
              bind:value={markdown}
              bind:busy={uploading}
              {upload}
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
        <h2 class="serif pb-4 text-xl">{t("出版信息")}</h2>
        <div class="field">
          <label for="slug"
            >{kind === "page" ? t("页面路径") : t("文章网址")}</label
          >
          <div class="flex items-center gap-2">
            {#if kind === "page"}<span aria-hidden="true">/</span>{/if}<Input
              id="slug"
              bind:value={slug}
              placeholder={kind === "page" ? "about" : "hello-world"}
              aria-invalid={!!slugError}
              aria-describedby={slugError ? "slug-error" : undefined}
              oninput={() => (slugError = "")}
              disabled={saving || translating}
            />
          </div>
          {#if slugError}<p id="slug-error" class="error text-sm" role="alert">
              {slugError}
            </p>{/if}
        </div>
        <div class="field">
          <label for="excerpt">{t("摘要")}</label><Textarea
            id="excerpt"
            bind:value={excerpt}
            rows={4}
            maxlength={600}
            disabled={saving || translating}
          />
        </div>
        {#if kind === "article"}<fieldset class="space-y-3">
            <legend class="text-sm font-medium">{t("标签")}</legend>
            <div class="flex flex-wrap gap-2">
              {#each tags as tag}<label
                  class="flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm"
                  ><input
                    type="checkbox"
                    value={tag.id}
                    bind:group={tagIds}
                    disabled={saving || translating}
                  />{tag.name}</label
                >{/each}
            </div>
            <Button
              variant="ghost"
              class="justify-start px-0"
              onclick={() => (creatingTag = !creatingTag)}
              disabled={saving || translating}>{t("＋ 新建标签")}</Button
            >
          </fieldset>
          {#if creatingTag}<div class="space-y-3 rounded-2xl bg-secondary p-4">
              <h3 class="text-sm">{t("新建标签")}</h3>
              <Input
                aria-label={t("名称")}
                bind:value={termName}
                placeholder={t("名称")}
                disabled={saving || translating}
              /><Input
                aria-label={t("网址标识")}
                bind:value={termSlug}
                placeholder="notes"
                disabled={saving || translating}
              />
              <div class="flex gap-2">
                <Button
                  disabled={saving || !termName.trim() || !termSlug}
                  onclick={createTerm}>{t("保存")}</Button
                ><Button
                  variant="ghost"
                  disabled={saving || translating}
                  onclick={() => (creatingTag = false)}>{t("取消")}</Button
                >
              </div>
            </div>{/if}{/if}
        <div class="field">
          <span class="text-sm font-medium">{t("封面")}</span>{#if coverId}<img
              class="cover"
              src={imagePath(coverId)}
              alt={t("{{kind}}封面", { kind: label })}
            /><Button
              variant="ghost"
              disabled={saving || translating}
              onclick={() => (coverId = null)}
              ><X size={16} />{t("移除封面")}</Button
            >{/if}<input
            bind:this={coverInput}
            type="file"
            class="hidden"
            accept="image/png,image/jpeg,image/webp,image/gif"
            aria-label={t("封面图片")}
            onchange={uploadCover}
          /><Button
            variant="outline"
            disabled={saving || uploading}
            onclick={() => coverInput?.click()}
            ><ImagePlus size={16} />{uploading
              ? t("正在上传…")
              : t("上传封面")}</Button
          >
        </div>
        {#if original}<div class="pt-6">
            {#if deleting}<p class="mb-3 text-sm">{t("删除这个{{kind}}？",{kind:label})}</p>
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
                onclick={() => (deleting = true)}>{t("删除{{kind}}",{kind:label})}</Button
              >{/if}
          </div>{/if}
      </aside>
    </div>{/if}
</section>

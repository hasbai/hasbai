<script lang="ts">
  import { ui, links, dates } from "$lib/i18n";
  const t = ui();
  const dateLabel = dates();
  const link = links();
  import { site, writingPath, yearLabel, type Writing } from "$lib/content";
  import { reveal } from "$lib/reveal";
  let { data } = $props();
  const groups = $derived.by(() => {
    const years = new Map<string, Writing[]>();
    for (const writing of data.writings) {
      const year = yearLabel(writing.published_at);
      years.set(year, [...(years.get(year) ?? []), writing]);
    }
    return [...years];
  });
  const articleCount = $derived(
    data.writings.filter((writing: Writing) => writing.kind === "article")
      .length,
  );
  const noteCount = $derived(data.writings.length - articleCount);
  function monthLabel(value: string | null) {
    return value
      ? new Date(value).toLocaleDateString(data.locale, {
          month: "long",
          timeZone: "Asia/Shanghai",
        })
      : t("未定日期");
  }
  function dayLabel(value: string | null) {
    return value
      ? new Date(value).toLocaleDateString(data.locale, {
          day: "2-digit",
          timeZone: "Asia/Shanghai",
        })
      : "—";
  }
</script>

<svelte:head
  ><title>{t("时间线 ·")} {site.name}</title><link
    rel="canonical"
    href={site.origin + link("/timeline")}
  /></svelte:head
>
<section class="wrap collection timeline-page">
  <div class="timeline-summary entrance">
    <h1>{t("时间线")}</h1>
    <p>
      <strong>{data.writings.length}</strong><span
        >{t("则记录，再按年翻阅")}</span
      >
    </p>
    <div class="timeline-stats" aria-label={t("内容统计")}>
      <span><strong>{articleCount}</strong><small>{t("文章")}</small></span
      ><span><strong>{noteCount}</strong><small>{t("手记")}</small></span><span
        ><strong>{groups.length}</strong><small>{t("年份")}</small></span
      >
    </div>
    <span class="timeline-hint">{t("写下此刻，留给以后。")}</span>
  </div>
  {#if groups.length}
    <div class="timeline-groups">
      {#each groups as [year, writings]}
        <section class="timeline-year" aria-label={year + t(" 年")}>
          <h2>{year}<span>{t("本年")} {writings.length} {t("则")}</span></h2>
          <div class="timeline-items">
            {#each writings as writing, index (writing.id)}
              {#if index === 0 || monthLabel(writing.published_at) !== monthLabel(writings[index - 1].published_at)}
                <p class="timeline-month">{monthLabel(writing.published_at)}</p>
              {/if}
              <a
                href={link(writingPath(writing))}
                class="timeline-item"
                use:reveal={index}
              >
                <time
                  datetime={writing.published_at ?? ""}
                  aria-label={dateLabel(writing.published_at)}
                  >{dayLabel(writing.published_at)}</time
                >
                <span class="timeline-title"
                  >{writing.kind === "article"
                    ? writing.title
                    : writing.excerpt || t("手记 №") + writing.sequence}</span
                >
                <span class="timeline-kind"
                  >{writing.kind === "article" ? t("文章") : t("手记")}</span
                >
                <span class="timeline-arrow" aria-hidden="true">↗</span>
              </a>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {:else}
    <div class="empty">
      <h2 class="serif text-3xl">{t("时间线尚无内容")}</h2>
      <a href={link("/articles")}>{t("浏览文章 →")}</a>
    </div>
  {/if}
</section>

<script lang="ts">
  import { ui, links, dates } from "$lib/i18n";
  const t = ui();
  const dateLabel = dates();
  const link = links();
  import { site, writingPath } from "$lib/content";
  import { reveal } from "$lib/reveal";
  import { BookOpen, Clock3, NotebookPen } from "@lucide/svelte";
  import SnowflakeMark from "$lib/components/SnowflakeMark.svelte";
  let { data } = $props();
</script>

<svelte:head>
  <title>{site.name} {t("— 写下此刻，留给以后。")}</title>
  <meta name="description" content={site.name + t("，记录思考与日常。")} />
  <link rel="canonical" href={site.origin+link("/")} />
</svelte:head>

<section class="home-hero hero-scroll-container wrap">
  <div class="hero-glow hero-exit-bg" aria-hidden="true"></div>
  <div class="hero-center">
    <span class="hero-seal hero-rise" aria-hidden="true"
      ><SnowflakeMark size={55} /></span
    >
    <h1 class="hero-exit-text">
      <span class="hero-greeting"
        >{t("Hi, 这里是")} <em>{site.name}</em><span
          class="hero-wave"
          aria-hidden="true"><SnowflakeMark size={20} strokeWidth={2.2} /></span
        ></span
      ><span class="hero-statement"
        >{t("把")} <em>{t("想法")}</em> {t("写成文字，留下日常。")}</span
      >
    </h1>
    <p class="hero-description hero-rise hero-exit-meta">
      {t("写一点思考，记一些日常，让值得留下的文字慢慢生长。")}
    </p>
  </div>
  <div class="hero-whisper hero-rise hero-exit-meta">
    <p>{t("「写下此刻，留给以后。」")}</p>
    <nav class="hero-links" aria-label={t("探索") + site.name}>
      <a href={link("/articles")} aria-label={t("浏览文章")}
        ><BookOpen size={19} /></a
      >
      <a href={link("/notes")} aria-label={t("浏览手记")}
        ><NotebookPen size={19} /></a
      >
      <a href={link("/timeline")} aria-label={t("浏览时间线")}
        ><Clock3 size={19} /></a
      >
    </nav>
  </div>
</section>

<section class="wrap recent-section" id="recent">
  <div class="section-intro" use:reveal>
    <span class="eyebrow">RECENT WRITING</span>
    <div><h2 class="serif">{t("近期笔墨")}</h2></div>
  </div>
  {#if data.recent.length}
    <div class="recent-list">
      {#each data.recent as writing, index (writing.id)}
        <a
          class="recent-item"
          href={link(writingPath(writing))}
          use:reveal={index}
        >
          <span class="recent-index">{String(index + 1).padStart(2, "0")}</span>
          <span class="recent-body"
            ><span class="recent-title serif"
              >{writing.kind === "article"
                ? writing.title
                : writing.excerpt || t("手记 №") + writing.sequence}</span
            ><span class="recent-meta"
              >{writing.kind === "article" ? t("文章") : t("手记")} ·
              <time datetime={writing.published_at ?? ""}
                >{dateLabel(writing.published_at)}</time
              ></span
            ></span
          >
          <span class="recent-arrow" aria-hidden="true">↗</span>
        </a>
      {/each}
    </div>
  {:else}
    <div class="empty">
      <h3 class="serif text-3xl">{t("还没有文字")}</h3>
      <a href={link("/studio/new")}>{t("写下第一篇 →")}</a>
    </div>
  {/if}
</section>

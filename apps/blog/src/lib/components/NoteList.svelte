<script lang="ts">
  import { ui, links, dates } from "$lib/i18n";
  const t = ui();
  const dateLabel = dates();
  const link = links();
  import { notePath, yearLabel, type Note } from "$lib/content";
  import { reveal } from "$lib/reveal";
  import { Button } from "@hasbai/ui/button";
  let {
    notes,
    page = 1,
    more = false,
  }: { notes: Note[]; page?: number; more?: boolean } = $props();
  const groups = $derived.by(() => {
    const years = new Map<string, Note[]>();
    for (const note of notes) {
      const year = yearLabel(note.published_at);
      years.set(year, [...(years.get(year) ?? []), note]);
    }
    return [...years];
  });
</script>

<section class="wrap collection note-collection">
  <div class="collection-heading entrance">
    <span class="eyebrow">NOTES</span>
    <h1>{t("手记")}</h1>
  </div>
  {#if notes.length}
    {#each groups as [year, group]}
      <section class="note-year" aria-label={year + t(" 年手记")}>
        <div class="note-year-heading">
          <h2>{year}</h2>
          <span class="meta">{group.length} {t("则")}</span>
        </div>
        <div class="note-track">
          {#each group as note, index (note.id)}
            <article class="note-entry" use:reveal={index}>
              <a
                class:featured={index === 0 && page === 1}
                class="note-paper"
                href={link(notePath(note))}
              >
                <span class="note-banner"
                  ><span>NOTE №{note.sequence}</span><svg
                    class="note-banner-wave"
                    viewBox="0 0 800 80"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    ><path class="note-banner-axis" d="M0 40H800" /><path
                      d="M0 40 C25 40 35 34 50 34 S70 8 86 8 S108 67 130 67 S155 20 176 20 S198 55 224 55 S249 29 270 29 S297 45 320 45 S345 25 370 25 S395 52 420 52 S451 18 476 18 S501 69 526 69 S548 14 573 14 S601 58 625 58 S648 30 674 30 S700 38 725 38 S750 23 775 23 S790 40 800 40"
                    /></svg
                  ></span
                >
                <span class="note-paper-content">
                  <time datetime={note.published_at ?? ""}
                    >{dateLabel(note.published_at)}</time
                  >
                  <span class="note-excerpt serif"
                    >{note.excerpt || t("一则手记")}</span
                  >
                  <span class="note-read">{t("阅读全文 →")}</span>
                </span>
              </a>
            </article>
          {/each}
        </div>
      </section>
    {/each}
    {#if page > 1 || more}<nav class="pager" aria-label={t("手记分页")}>
        <Button
          variant="ghost"
          href={link("?page=" + (page - 1))}
          disabled={page === 1}>{t("← 上一页")}</Button
        >
        <span class="meta">{page}</span>
        <Button
          variant="ghost"
          href={link("?page=" + (page + 1))}
          disabled={!more}>{t("下一页 →")}</Button
        >
      </nav>{/if}
  {:else}
    <div class="empty">
      <h2 class="text-3xl">{t("还没有手记")}</h2>
      <Button href={link("/studio/notes/new")}>{t("写第一则")}</Button>
    </div>
  {/if}
</section>

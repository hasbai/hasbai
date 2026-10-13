<script lang="ts">
  import "../app.css";
  import { onMount, setContext } from "svelte";
  import { navigating, page } from "$app/state";
  import { Button } from "@hasbai/ui/button";
  import { Sun, Moon, PenLine } from "@lucide/svelte";
  import SnowflakeMark from "$lib/components/SnowflakeMark.svelte";
  import BackgroundEffect from "$lib/components/BackgroundEffect.svelte";
  import {
    localeFromPath,
    localizedPath,
    withoutLocale,
    languageName,
  } from "$lib/locales";
  import { translateUI } from "$lib/i18n";
  import { goto } from "$app/navigation";
  import { site } from "$lib/content";
  let { children } = $props();
  const locale = $derived(
    page.data.locale ?? localeFromPath(page.url.pathname),
  );
  setContext("blog-locale", () => locale);
  setContext(
    "blog-languages",
    () => page.data.available ?? ["zh-CN", "zh-TW", "en-US"],
  );
  const t = (text: string) => translateUI(locale, text);
  const link = (path: string) =>
    localizedPath(path, locale, page.data.available);
  $effect(() => {
    document.documentElement.lang = locale;
  });
  let dark = $state(false);
  let scrolled = $state(false);
  const nav = $derived([
    { href: "/", label: t("首页") },
    { href: "/articles", label: t("文章") },
    { href: "/notes", label: t("手记") },
    { href: "/timeline", label: t("时间线") },
    { href: "/about", label: t("关于") },
  ]);
  function current(href: string) {
    return href === "/"
      ? withoutLocale(page.url.pathname, page.data.available) === "/"
      : withoutLocale(page.url.pathname, page.data.available) === href ||
          withoutLocale(page.url.pathname, page.data.available).startsWith(
            href + "/",
          );
  }
  function applyTheme(value: boolean) {
    dark = value;
    document.documentElement.classList.toggle("dark", value);
  }
  onMount(() => {
    const saved = localStorage.getItem("hasbai.theme");
    applyTheme(
      saved
        ? saved === "dark"
        : matchMedia("(prefers-color-scheme: dark)").matches,
    );
    const updateScroll = () => {
      scrolled = scrollY > 28;
    };
    updateScroll();
    addEventListener("scroll", updateScroll, { passive: true });
    return () => removeEventListener("scroll", updateScroll);
  });
  function toggleTheme() {
    applyTheme(!dark);
    localStorage.setItem("hasbai.theme", dark ? "dark" : "light");
  }
</script>

<svelte:head>
  <title>{site.name}</title>
  <meta name="theme-color" content={dark ? "#1c1c1e" : "#fefefb"} />
</svelte:head>
<a class="skip" href="#main">{t("跳转至正文")}</a>
<BackgroundEffect />
{#if page.route.id === "/[slug=pageSlug]" || page.url.pathname.startsWith("/articles/") || /^\/notes\/\d+$/.test(page.url.pathname)}
  <div class="page-bleed" aria-hidden="true">
    <svg viewBox="0 0 1440 120" preserveAspectRatio="none"
      ><path d="M-20 18 C260 19 330 12 570 18 S980 23 1460 15" /><path
        d="M-20 43 C220 40 350 49 610 40 S1030 33 1460 44"
      /><path d="M-20 68 C300 71 380 59 650 66 S1040 74 1460 65" /><path
        d="M-20 93 C270 89 410 101 720 92 S1110 87 1460 96"
      /></svg
    >
  </div>
{/if}
<header class:scrolled class="site-header">
  <div class="header-inner wrap">
    <a class="wordmark" href={link("/")} aria-label={site.name + t("首页")}
      ><span class="wordmark-symbol" aria-hidden="true"
        ><SnowflakeMark size={27} strokeWidth={2.3} /></span
      ><span class="wordmark-label">{site.name}</span></a
    >
    <nav class="site-nav" aria-label={t("主导航")}>
      {#each nav as item}<a
          href={link(item.href)}
          aria-current={current(item.href) ? "page" : undefined}>{item.label}</a
        >{/each}
    </nav>
    <div class="header-actions">
      <select
        class="language-switch"
        aria-label={t("语言")}
        value={locale}
        onchange={(event) =>
          goto(
            localizedPath(
              page.url.pathname,
              event.currentTarget.value,
              page.data.available,
            ) +
              page.url.search +
              page.url.hash,
          )}
      >
        {#each page.data.locales ?? ["zh-CN", "zh-TW", "en-US"] as language}<option
            value={language}>{languageName(language)}</option
          >{/each}
      </select>
      <Button
        variant="ghost"
        size="icon"
        aria-label={dark ? t("切换浅色") : t("切换深色")}
        onclick={toggleTheme}
      >
        {#if dark}<Sun size={18} />{:else}<Moon size={18} />{/if}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        href={link("/studio")}
        class="write-link"
        aria-label={t("写作")}><PenLine size={18} /></Button
      >
    </div>
  </div>
</header>
<main id="main">
  {#if navigating.to && navigating.to.url.href !== page.url.href}
    <section
      class="wrap navigation-skeleton"
      aria-label={t("正在打开页面")}
      aria-busy="true"
    >
      <div class="skeleton-line skeleton-kicker"></div>
      <div class="skeleton-line skeleton-title"></div>
      <div class="skeleton-line skeleton-subtitle"></div>
      <div class="skeleton-block"></div>
      <div class="skeleton-block"></div>
    </section>
  {:else}
    {@render children()}
  {/if}
</main>
<footer class="wrap footer">
  <div class="footer-links">
    <nav aria-label={t("页脚导航")}>
      <a href={link("/privacy")}>{t("隐私政策")}</a><a href={link("/terms")}
        >{t("服务条款")}</a
      >
    </nav>
    {#if withoutLocale(page.url.pathname, page.data.available) === "/"}
      <p class="footer-note">{t("本站公开阅读，编辑发布需登录后使用。")}</p>
    {/if}
  </div>
  <span class="footer-mark">© {new Date().getFullYear()} HASBAI</span>
</footer>

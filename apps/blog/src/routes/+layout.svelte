<script lang="ts">
 import { pageMotion } from "@hasbai/ui/motion";
  import "../app.css";
  import { onMount, setContext } from "svelte";
  import { navigating, page } from "$app/state";
  import { Notifications, createNotifications } from "@hasbai/ui/notice";
  createNotifications();
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
  const languages = $derived(page.data.locales ?? ["zh-CN", "zh-TW", "en-US"]);
  const languageLabels: Record<string, string> = { "zh-CN": "简", "zh-TW": "繁", "en-US": "EN" };
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
      <nav
        class="language-switch"
        aria-label={t("语言")}
        style:--language-count={languages.length}
        style:--language-index={Math.max(0, languages.indexOf(locale))}
      >
        <span class="language-indicator" aria-hidden="true"></span>
        {#each languages as language}
          <a
            href={localizedPath(page.url.pathname, language, page.data.available) + page.url.search + page.url.hash}
            lang={language}
            aria-label={languageName(language)}
            aria-current={locale === language ? "page" : undefined}
            title={languageName(language)}
          >{languageLabels[language] ?? languageName(language)}</a>
        {/each}
      </nav>
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
<main use:pageMotion={page.url.pathname} id="main">
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

<Notifications label={t("消息提示")} closeLabel={t("关闭提示")} />

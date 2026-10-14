import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.beforeEach(async ({ request }) => {
  await request.get('http://127.0.0.1:4180/reset');
});

test('desktop background paints and respects reduced motion', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.context().route(/\/petals-fallback\.svg$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body, '::after').backgroundImage)).toContain('petals-fallback.svg');
  await page.context().unroute(/\/petals-fallback\.svg$/);
  const background = page.locator('.background-texture');
  await expect(background).toHaveClass(/visible/);
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.background-texture');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return 0;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) return 1;
    return 0;
  })).toBe(1);
  await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.body, '::after').opacity))).toBe(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(background).not.toHaveClass(/visible/);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body, '::after').content)).toBe('none');
});

test('SSR, direct Data API navigation, skeleton, canonical URLs and reading states', async ({ page, request }) => {
  const response = await request.get('/articles/hello-world');
  expect(await response.text()).toContain('从一页空白开始');
  const dataRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('__data.json')) dataRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /北极小站/ })).toBeVisible();
  await expect(page).toHaveTitle('北极小站 — 写下此刻，留给以后。');
  await expect(page.getByRole('link', { name: '北极小站首页', exact: true, includeHidden: true })).toHaveAttribute('href', '/');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', '北极小站，记录思考与日常。');
  const home = await request.get('/', { maxRedirects: 0 });
  expect(home.status()).toBe(200);
  expect(await home.text()).toContain('本站公开阅读，编辑发布需登录后使用。');
  await expect(page.locator('.hero-description')).toHaveText('写一点思考，记一些日常，让值得留下的文字慢慢生长。');
  await expect(page.locator('.footer-note')).toHaveText('本站公开阅读，编辑发布需登录后使用。');
  const footerNavigation = await page.getByRole('navigation', { name: '页脚导航' }).boundingBox();
  const footerNote = await page.locator('.footer-note').boundingBox();
  expect(footerNavigation).not.toBeNull();
  expect(footerNote).not.toBeNull();
  expect(footerNote!.x).toBe(footerNavigation!.x);
  expect(footerNote!.y).toBeGreaterThanOrEqual(footerNavigation!.y + footerNavigation!.height);
  await expect(page).toHaveScreenshot('home.png', { fullPage: true });
  await page.getByRole('button', { name: '切换深色' }).click();
  await expect(page.locator('.hero-center h1')).toHaveCSS('color', 'rgb(240, 240, 240)');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page).toHaveScreenshot('home-dark.png', { fullPage: true });
  await page.getByRole('button', { name: '切换浅色' }).click();

  let releaseArticles!: () => void;
  const articlesPending = new Promise<void>((resolve) => { releaseArticles = resolve; });
  await page.route(/\/rest\/v1\/content\?/, async (route) => {
    await articlesPending;
    await route.continue();
  });
  const navigate = page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '文章' }).click();
  try {
    await expect(page.getByLabel('正在打开页面')).toBeVisible();
  } finally {
    releaseArticles();
    await navigate.catch(() => {});
  }
  await navigate;
  await expect(page.getByRole('heading', { name: '文章', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('文章 · 北极小站');
  expect(dataRequests).toEqual([]);
  await page.unroute(/\/rest\/v1\/content\?/);
  await expect(page).toHaveScreenshot('articles.png', { fullPage: true });

  await page.getByRole('link', { name: /Hello World，开始记录/ }).click();
  await expect(page).toHaveURL(/\/articles\/hello-world$/);
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://hasbai.xyz/articles/hello-world');
  await expect(page.locator('main')).not.toContainText(/ARTICLE \/|LETTER №|RECENT WRITING|THE WRITING ROOM/);
  await expect(page).toHaveScreenshot('article.png', { fullPage: true });
  await page.getByRole('button', { name: '切换深色' }).click();
  await expect(page.locator('article.reading')).toHaveCSS('opacity', '1');
  await expect(page.locator('.article-title')).toHaveCSS('color', 'rgb(240, 240, 240)');
  await expect(page.locator('.prose')).toHaveCSS('color', 'rgb(240, 240, 240)');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page).toHaveScreenshot('article-dark.png', { fullPage: true });
  await page.getByRole('button', { name: '切换浅色' }).click();

  const common = await request.get('/contents/20000000-0000-4000-8000-000000000001');
  expect(common.url()).toContain('/articles/hello-world');
  const legacy = await request.get('/notes/hello-world', { maxRedirects: 0 });
  expect(legacy.status()).toBe(308);
  expect(legacy.headers().location).toBe('/articles/hello-world');

  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '手记' }).click();
  await expect(page.getByRole('heading', { name: '手记', exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot('notes.png', { fullPage: true });
  await page.getByRole('link', { name: /今天想把一个简单的念头/ }).click();
  await expect(page).toHaveURL(/\/notes\/1$/);
  await expect(page).toHaveScreenshot('note.png', { fullPage: true });
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '时间线' }).click();
  await expect(page).toHaveScreenshot('timeline.png', { fullPage: true });
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '关于' }).click();
  await expect(page).toHaveTitle('关于北极小站 · 北极小站');
  await expect(page).toHaveScreenshot('about.png', { fullPage: true });
  await page.goto('/tags/writing');
  await expect(page).toHaveScreenshot('tag.png', { fullPage: true });

  await request.get('http://127.0.0.1:4180/empty');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '还没有文字' })).toBeVisible();
  await expect(page).toHaveScreenshot('empty.png', { fullPage: true });
  await request.get('http://127.0.0.1:4180/fail');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '内容暂时无法加载' })).toBeVisible();
  await expect(page).toHaveScreenshot('error.png', { fullPage: true });
});

test('editor writes articles and titleless notes through Data API', async ({ page }) => {
  await page.goto('/auth/callback?code=fixture&state=fixture');
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.getByRole('heading', { name: '编辑室', exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot('studio.png', { fullPage: true });

  await page.getByRole('link', { name: '新文章' }).click();
  await page.getByLabel('标题', { exact: true }).fill('测试文章');
  await page.getByLabel('文章网址').fill('test-article');
  await page.getByRole('textbox', { name: '正文' }).fill('一次新的写作。');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await page.getByLabel('Markdown 源码').fill('## 标题\n\n保存并发布。');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(page).toHaveScreenshot('editor.png', { fullPage: true });
  const articleSave = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/content');
  await page.getByRole('button', { name: '发布文章', exact: true }).click();
  expect((await articleSave).postDataJSON()).toMatchObject({ kind:'article', value:{status:'published',markdown:expect.stringContaining('## 标题')} });
  await expect(page.getByRole('link', { name: '查看' })).toBeVisible();

  await page.goto('/studio/notes/new');
  await expect(page).toHaveTitle('新手记 · 编辑室 · 北极小站');
  await page.getByRole('textbox', { name: '正文' }).fill('今天的一则手记。');
  await expect(page).toHaveScreenshot('note-editor.png', { fullPage: true });
  const noteSave = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/content');
  await page.getByRole('button', { name: '发布手记', exact: true }).click();
  const noteBody = (await noteSave).postDataJSON().value;
  expect(noteBody).toMatchObject({status:'published'});
  expect(noteBody).not.toHaveProperty('title');
  expect(noteBody).not.toHaveProperty('tag_ids');
  await expect(page.getByRole('link', { name: '查看' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('standalone pages stay out of feeds and support editable paths', async ({ page, request }) => {
  const policy = await request.get('/privacy');
  expect(policy.status()).toBe(200);
  expect(await policy.text()).toContain('jsclndnz@gmail.com');
  expect(await policy.text()).toContain('Google 身份信息的存储与共享');
  expect(await policy.text()).not.toContain('AI 文字对话与日志');
  expect(await policy.text()).not.toContain('Auth0 的 Google 连接');
  const uuid = await request.get('/contents/40000000-0000-4000-8000-000000000002', { maxRedirects: 0 });
  expect(uuid.status()).toBe(308);
  expect(uuid.headers().location).toBe('/privacy');
  await page.goto('/privacy');
  await expect(page).toHaveTitle('隐私政策 · 北极小站');
  await expect(page.getByRole('heading', { name: '隐私政策', exact: true })).toBeVisible();
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://hasbai.xyz/privacy');
  await expect(page.locator('.prose').getByRole('link', { name: 'hasbai.xyz', exact: true })).toHaveAttribute('href', 'https://hasbai.xyz');
  const nav = page.getByRole('navigation', { name: '主导航' });
  await expect(nav.getByRole('link', { name: '关于' })).toBeVisible();
  await expect(nav.getByRole('link', { name: '隐私政策' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: '服务条款' })).toHaveCount(0);
  await expect(page.locator('footer')).not.toContainText('写下此刻');
  await expect(page.locator('footer a')).toHaveCount(2);
  await expect(page.locator('a')).not.toContainText(['↗']);
  await expect(page).toHaveScreenshot('privacy.png', { fullPage: true });
  await page.getByRole('button', { name: '切换深色' }).click();
  await expect(page).toHaveScreenshot('privacy-dark.png', { fullPage: true });
  await page.getByRole('button', { name: '切换浅色' }).click();
  await page.getByRole('navigation', { name: '页脚导航' }).getByRole('link', { name: '服务条款' }).click();
  await expect(page.getByRole('heading', { name: '服务条款', exact: true })).toBeVisible();
  await expect(page.locator('.prose')).toContainText('AI NCII');
  await expect(page).toHaveScreenshot('terms.png', { fullPage: true });
  await page.goto('/');
  await expect(page.locator('.recent-list')).not.toContainText('隐私政策');
  await page.goto('/timeline');
  await expect(page.locator('main')).not.toContainText('隐私政策');

  await page.goto('/auth/callback?code=fixture&state=fixture');
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page).toHaveTitle('编辑室 · 北极小站');
  await page.getByRole('button', { name: '独立页面', exact: true }).click();
  await expect(page.getByRole('heading', { name: '关于北极小站', exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot('pages-studio.png', { fullPage: true });
  await page.getByRole('link', { name: '新页面', exact: true }).click();
  await page.getByLabel('标题', { exact: true }).fill('自定义页面');
  await page.getByLabel('页面路径').fill('studio');
  await page.getByRole('textbox', { name: '正文' }).fill('独立页面正文。');
  await page.getByRole('button', { name: '发布页面', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('该路径已用于网站功能');
  await expect(page.getByLabel('页面路径')).toBeFocused();
  await page.getByLabel('页面路径').fill('privacy');
  await page.getByRole('button', { name: '发布页面', exact: true }).click();
  await expect(page.getByRole('region', { name: '消息提示' }).getByRole('alert')).toContainText('页面路径已被使用');
  await expect(page.locator('main')).not.toContainText('页面路径已被使用');
  await page.getByRole('button', { name: '关闭提示' }).click();
  await expect(page.getByLabel('标题', { exact: true })).toHaveValue('自定义页面');
  await page.getByLabel('页面路径').fill('custom-page');
  await expect(page).toHaveScreenshot('page-editor.png', { fullPage: true });
  const save = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/content');
  await page.getByRole('button', { name: '发布页面', exact: true }).click();
  expect((await save).postDataJSON().value).toMatchObject({ title: '自定义页面', slug: 'custom-page', status: 'published' });
  await expect(page).toHaveURL(/\/studio\/pages\/[\da-f-]+$/);
  await expect(page.getByRole('link', { name: '查看', exact: true })).toHaveAttribute('href', '/custom-page');
  await page.getByLabel('页面路径').fill('changed-page');
  await page.getByRole('button', { name: '更新页面', exact: true }).click();
  await expect(page.getByRole('link', { name: '查看', exact: true })).toHaveAttribute('href', '/changed-page');
  await page.getByLabel('标题', { exact: true }).fill('未保存的标题');
  await expect(page.locator('main').getByRole('status')).toHaveText('未保存');
  const discard = page.waitForEvent('dialog');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: '编辑室', exact: true }).click();
  expect((await discard).message()).toBe('离开并放弃未保存的修改？');
  await expect(page).toHaveURL(/\/studio\/pages\/[\da-f-]+$/);
  await expect(page.getByLabel('标题', { exact: true })).toHaveValue('未保存的标题');
  await page.getByLabel('标题', { exact: true }).fill('自定义页面');
  await page.getByRole('button', { name: '删除页面', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page).toHaveURL(/\/studio$/);
  expect((await request.get('/changed-page')).status()).toBe(404);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('ordinary logged-in users can read published content but cannot enter the editor', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fixture-ordinary', 'true'));
  await page.goto('/studio');
  await expect(page.getByRole('alert')).toHaveText('当前账号没有编辑权限');
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
  await expect(page.getByRole('link', { name: '写文章' })).toHaveCount(0);
  await expect(page).toHaveScreenshot('studio-denied.png', { fullPage: true });
  await page.getByRole('button', { name: '切换深色' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByRole('button', { name: '切换浅色' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '编辑室', exact: true })).toHaveCSS('color', 'rgb(240, 240, 240)');
  const actions = page.locator('.header-actions [data-slot="button"]');
  for (let index = 0; index < 2; index++) await expect(actions.nth(index)).toHaveCSS('color', 'rgb(240, 240, 240)');
  await expect(page).toHaveScreenshot('studio-denied-dark.png', { fullPage: true });
  await page.goto('/articles/hello-world');
  await expect(page.getByRole('heading', { name: 'Hello World，开始记录' })).toBeVisible();
});


test('Markdown extensions render safely and survive editor preview and save', async ({ page, request }) => {
  test.setTimeout(120_000);
  const source = readFileSync(new URL('./markdown-extensions.md', import.meta.url), 'utf8');
  await request.patch('http://127.0.0.1:4180/rest/v1/article?id=eq.20000000-0000-4000-8000-000000000001', { data: { markdown: source } });
  const ssr = await request.get('/articles/hello-world');
  const markup = await ssr.text();
  expect(markup).toContain('class="katex"');
  expect(markup).not.toContain('title: 不覆盖文章标题');
  const graphRequests: string[] = [];
  const manifest: Record<string, { file: string }> = JSON.parse(readFileSync(new URL('../.svelte-kit/output/client/.vite/manifest.json', import.meta.url), 'utf8'));
  const graphAssets = new Set(Object.entries(manifest).filter(([key]) => /\/(?:mermaid|markmap-lib|markmap-view|@terrastruct\/d2)\//.test(key) || key.endsWith('/markdown/src/diagrams.ts')).map(([, entry]) => '/' + entry.file));
  expect(graphAssets.size).toBeGreaterThan(3);
  page.on('request', request => { if (graphAssets.has(new URL(request.url()).pathname)) graphRequests.push(request.url()); });
  await page.goto('/');
  expect(graphRequests).toEqual([]);
  await page.goto('/articles/hello-world');
  await expect(page.locator('[data-diagram="d2"][data-state="ready"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-diagram="mermaid"][data-state="ready"]')).toHaveCount(1);
  await expect(page.locator('[data-diagram="markmap"][data-state="ready"]')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('mermaid 图表渲染失败');
  expect(graphRequests.length).toBeGreaterThan(0);
  await expect(page.locator('.katex')).toHaveCount(2);
  await expect(page.locator('.markdown-callout')).toHaveCount(2);
  await expect(page.locator('.footnotes')).toContainText('示例研究文献');
  await expect(page.locator('input[type="checkbox"]')).toHaveCount(2);
  const reference = page.locator('a[data-footnote-ref]').first();
  const target = await reference.getAttribute('href');
  await reference.click();
  await expect(page.locator(target!)).toBeVisible();
  const back = page.locator(target!).getByRole('link', { name: '返回引用' });
  await back.click();
  await expect(reference).toBeFocused();
  await page.getByRole('button', { name: '放大', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '适应', exact: true }).click();
  await page.evaluate(() => scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page).toHaveScreenshot('markdown-extensions.png', { fullPage: true });
  await page.getByRole('button', { name: '切换深色' }).click();
  await expect(page.locator('[data-state="ready"]')).toHaveCount(3, { timeout: 60_000 });
  await expect(page.getByRole('alert')).toBeVisible();
  const mermaidImage = page.locator('[data-diagram="mermaid"][data-state="ready"] img');
  const geometry = await mermaidImage.evaluate(async (image: HTMLImageElement) => {
    const root = new DOMParser().parseFromString(await (await fetch(image.src)).text(), 'image/svg+xml').documentElement;
    return root.getAttribute('viewBox')!.split(/[ ,]+/).map(Number);
  });
  expect(geometry[0]).toBeGreaterThanOrEqual(0);
  expect(geometry[2]).toBeGreaterThanOrEqual(240);
  await expect(page).toHaveScreenshot('markdown-extensions-dark.png', { fullPage: true });
  await page.goto('/auth/callback?code=fixture&state=fixture');
  await expect(page).toHaveURL(/\/studio$/);
  await page.goto('/studio/20000000-0000-4000-8000-000000000001');
  await expect(page.getByLabel('Markdown 源码')).toHaveValue(source);
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.locator('[data-state="ready"]')).toHaveCount(3, { timeout: 60_000 });
  await expect(page).toHaveScreenshot('markdown-preview.png', { fullPage: true });
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(page.getByLabel('Markdown 源码')).toHaveValue(source);
  await page.getByLabel('Markdown 源码').fill(source + '\n新增正文。');
  const saved = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/content');
  await page.getByRole('button', { name: '更新文章', exact: true }).click();
  expect((await saved).postDataJSON().value.markdown).toBe(source + '\n新增正文。');
  await expect(page.getByRole('link', { name: '查看', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Markdown 源码')).toHaveValue(source + '\n新增正文。');
});


test("multilingual routes, fallback, language settings and translation editing", async ({
  page,
  request,
}) => {
  const id = "20000000-0000-4000-8000-000000000001";
  const english = {
    content_id: id,
    locale: "en-US",
    title: "Hello World, a new beginning",
    excerpt: "Writing gives our thoughts a shape.",
    markdown: "## A blank page\n\nKeep a moment in words.",
    updated_at: "2026-10-13T01:00:00Z",
  };
  await request.post("http://127.0.0.1:4180/fixture/translation", {
    data: english,
  });
  const ssr = await request.get("/en/articles/hello-world");
  expect(ssr.status()).toBe(200);
  expect(await ssr.text()).toContain("Hello World, a new beginning");
  await page.goto("/en/articles/hello-world?source=language#reading");
  await expect(
    page.getByRole("heading", { name: english.title }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(
    page.getByRole("link", { name: "Articles", exact: true }).first(),
  ).toHaveAttribute("href", "/en-US/articles");
  const languageSwitch = page.getByRole("navigation", { name: "Language", exact: true });
  await expect(languageSwitch.getByRole("link")).toHaveText(["简", "繁", "EN"]);
  await expect(languageSwitch.getByRole("link", { name: "English", exact: true })).toHaveAttribute("aria-current", "page");
  for (const action of await page.locator('.header-actions [data-slot="button"]').all()) {
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBe(44);
    expect(box!.height).toBe(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page).toHaveScreenshot("english-article.png", {
    fullPage: true,
  });
  await page.getByRole("navigation", { name: "Language", exact: true }).getByRole("link", { name: "繁體中文" }).click();
  await expect(
    page.getByRole("heading", { name: "Hello World，开始记录" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/zh-TW\/articles\/hello-world\?source=language#reading$/);
  await expect(page.getByRole("region", { name: "訊息提示" }).getByRole("status")).toHaveText("正在顯示简体中文原文");
  await expect(page.locator("main")).not.toContainText("正在顯示简体中文原文");
  await expect(page).toHaveScreenshot("traditional-article.png", {
    fullPage: true,
  });
  await page.goto("/en-US/studio");
  await expect(
    page.getByRole("heading", { name: "Studio", exact: true }),
  ).toBeVisible();
  await page.getByText("Translation settings", { exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "简体中文" })).toBeDisabled();
  await expect(page).toHaveScreenshot("language-settings.png", {
    fullPage: true,
  });
  await page.goto("/en-US/studio/" + id);
  await page.getByLabel("Content language").selectOption("en-US");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    english.title,
  );
  await expect(page).toHaveScreenshot("english-editor.png", { fullPage: true });
  await page
    .getByRole("textbox", { name: "Body", exact: true })
    .fill("Edited English body.");
  await expect(
    page.getByRole("button", { name: "Translate now" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Update article", exact: true })
    .click();
  await expect(page.getByRole("status").first()).not.toHaveText("Unsaved");
  await page.reload();
  await page.getByLabel("Content language").selectOption("en-US");
  await expect(
    page.getByRole("textbox", { name: "Body", exact: true }),
  ).toContainText("Edited English body.");
  await page.route("**/api/translate", async (route) => {
    const response = await request.post(
      "http://127.0.0.1:4180/fixture/translation",
      {
        data: {
          ...english,
          title: "Translated again",
          markdown: "New translation body.",
          updated_at: "2026-10-13T02:00:00Z",
        },
      },
    );
    await route.fulfill({ json: { item: await response.json() } });
  });
  await page.clock.install();
  await page.getByRole("button", { name: "Translate now" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Translated again",
  );
  await expect(
    page.getByRole("textbox", { name: "Body", exact: true }),
  ).toContainText("New translation body.");
  const notifications = page.getByRole("region", { name: "Notifications" });
  await expect(notifications.getByRole("status")).toHaveText("Translation saved");
  await expect(page.locator("main")).not.toContainText("Translation saved");
  await expect(notifications).toHaveCSS("position", "fixed");
  if (page.viewportSize()!.width <= 780) {
    const noticeBox = (await notifications.boundingBox())!;
    const navBox = (await page.getByRole("navigation", { name: "Main navigation" }).boundingBox())!;
    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(navBox.y - 8);
  }
  await notifications.hover();
  await expect(page).toHaveScreenshot("translation-notification.png", { fullPage: false });
  await page.getByRole("button", { name: "Switch to dark" }).click();
  await notifications.hover();
  await expect(page).toHaveScreenshot("translation-notification-dark.png", { fullPage: false });
  await page.getByRole("button", { name: "Switch to light" }).click();
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(notifications).toHaveCount(0);
  await page.route("**/api/translate", route => route.fulfill({ status: 503, json: { message: "翻译失败" } }));
  await page.getByRole("button", { name: "Translate now" }).click();
  await expect(notifications.getByRole("alert")).toHaveText("Translation failed");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Translated again");
  await expect(page).toHaveScreenshot("translation-error-notification.png", { fullPage: false });
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  // Both header navigation and editor language changes retain dirty input when cancelled.
  await page.getByLabel('Article URL').fill('unsaved-path');
  const editorUrl = page.url();
  const headerDiscard = new Promise<void>(resolve => page.once('dialog', async dialog => {
    await dialog.dismiss();
    resolve();
  }));
  await page.getByRole('navigation', { name: 'Language', exact: true }).getByRole('link', { name: '简体中文', exact: true }).click();
  await headerDiscard;
  await expect(page).toHaveURL(editorUrl);
  await expect(page.getByLabel('Article URL')).toHaveValue('unsaved-path');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByLabel('Content language').selectOption('zh-CN');
  await expect(page.getByLabel('Content language')).toHaveValue('en-US');
  await expect(page.getByLabel('Article URL')).toHaveValue('unsaved-path');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByLabel('Content language').selectOption('zh-CN');
  await expect(page.getByLabel('Article URL')).toHaveValue('hello-world');
  // An AI-delayed save returns another editor's full snapshot and version.
  await page.route('**/api/content',async route=>{
    const saved=await (await route.fetch()).json();
    const changed=await request.post('/api/content',{headers:{Authorization:route.request().headers().authorization},data:{kind:'article',id,updated_at:saved.item.updated_at,value:{locale:'zh-CN',title:'并发编辑标题',slug:'concurrent-path',excerpt:'并发摘要',markdown:'并发正文',cover_id:null,status:'draft',published_at:null,tag_ids:[]}}});
    await route.fulfill({json:await changed.json()});
  });
  await page.getByRole('button',{name:'Update article',exact:true}).click();
  await expect(page.getByLabel('Title',{exact:true})).toHaveValue('并发编辑标题');
  await expect(page.getByLabel('Article URL')).toHaveValue('concurrent-path');
  await expect(page.getByRole('textbox',{name:'Body',exact:true})).toContainText('并发正文');
  await expect(page.getByRole('region', { name: 'Notifications' }).getByRole('status')).toHaveText('Draft saved');
  await expect(page.locator('main').getByRole('status')).toHaveText('Draft');
  await notifications.hover();
  await page.clock.runFor(6000);
  await expect(notifications).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss notification' }).focus();
  await page.mouse.move(0, 0);
  await page.clock.runFor(6000);
  await expect(notifications).toBeVisible();
  await page.getByLabel('Title', { exact: true }).focus();
  await page.clock.runFor(5100);
  await expect(notifications).toHaveCount(0);
  await page.route('**/api/content', async route => {
    const saved = await (await route.fetch()).json();
    await route.fulfill({ json: { ...saved, item: { ...saved.item,
      translation_warning: '原文已保存，以下语言待翻译：zh-TW, en-US',
    } } });
  });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(notifications.getByRole('status')).toHaveText('Original saved. Translation pending: zh-TW, en-US');
  await page.clock.runFor(6000);
  await expect(notifications).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(notifications).toHaveCount(0);

});

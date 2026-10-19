import { test, expect, fitsViewport } from "./fixtures";

test("desktop overview and keyboard editor dialog", async ({ page, app }) => {
  await app.open();
  await expect(page.getByRole("heading", { name: "净资产" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "主要导航" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "移动导航" })).toBeHidden();
  await fitsViewport(page);
  await expect(page).toHaveScreenshot("overview.png", { fullPage: true });
  await page.getByRole("link", { name: "记一笔" }).focus();
  await expect(page.getByRole("link", { name: "记一笔" })).toHaveCSS("outline-offset", "-2px");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "新增交易" })).toBeVisible();
  const field = page.getByRole("textbox", { name: "商户 / 交易摘要" });
  const restingShadow = await field.evaluate(el => getComputedStyle(el).boxShadow);
  await field.focus();
  await expect(field).toHaveCSS("outline-offset", "-2px");
  await expect(field).toHaveCSS("outline-width", "2px");
  await expect(field).toHaveCSS("box-shadow", restingShadow);
  await expect(page).toHaveScreenshot("editor-dialog.png");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Escape preserves dirty editor input when discard is declined", async ({
  page,
  app,
}) => {
  await app.open("/transactions/7");
  await expect(page.getByRole("dialog", { name: "示例消费" })).toBeVisible();
  await page.getByRole("textbox", { name: "商户 / 交易摘要" }).fill("保留输入");
  await expect(page.getByRole("dialog", { name: "保留输入" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "保留输入" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "商户 / 交易摘要" }),
  ).toHaveValue("保留输入");
});

test('accounts without financial permission cannot access the ledger', async ({ page }) => {
  await page.goto('/e2e/index.html?path=/&authorized=false');
  await expect(page.getByRole('heading', { name: '当前账号没有访问权限' })).toBeVisible();
  await expect(page.getByRole('link', { name: '记一笔' })).toHaveCount(0);
  await expect(page).toHaveScreenshot('ledger-denied.png', { fullPage: true });
});

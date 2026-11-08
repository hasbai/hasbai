import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  test,
  expect,
  fitsViewport,
  reachable,
  sheetFitsViewport,
} from "./fixtures";

test("long category groups and accounts scroll inside the sheet", async ({
  page,
  app,
}) => {
  await page.route("**/test-api/account?*", (route) =>
    route.fulfill({
      json: Array.from({ length: 64 }, (_, i) => ({
        id: i + 1,
        type: "支出",
        subtype: i < 32 ? "较长的日常生活支出分类" : `其他分类 ${i}`,
        name: `需要完整显示的较长科目名称 ${i}`,
        notes: null,
      })),
    }),
  );
  await page.setViewportSize({ width: 320, height: 420 });
  await app.open("/transactions/new");
  await page.getByRole("combobox", { name: "分类", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await sheetFitsViewport(dialog);
  const lastGroup = dialog.getByRole("option", { name: /其他分类 63/ });
  await lastGroup.scrollIntoViewIfNeeded();
  await reachable(lastGroup);
  const firstGroup = dialog.getByRole("option", {
    name: /较长的日常生活支出分类/,
  });
  await firstGroup.scrollIntoViewIfNeeded();
  await firstGroup.click();
  const lastItem = dialog.getByRole("option", {
    name: "需要完整显示的较长科目名称 31",
    exact: true,
  });
  await lastItem.scrollIntoViewIfNeeded();
  await reachable(lastItem);
  const list = dialog.locator('[data-slot="command-list"]');
  await expect(list).toHaveCSS("scrollbar-width", "none");
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await sheetFitsViewport(dialog);
  await lastItem.click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("combobox", { name: "分类", exact: true }).click();
  await dialog.getByRole("combobox", { name: "搜索分类" }).fill("无匹配结果");
  await expect(dialog.getByText("无匹配科目")).toBeVisible();
  await sheetFitsViewport(dialog);
  await reachable(dialog.getByRole("button", { name: "关闭分类选择" }));
  await dialog.getByRole("button", { name: "关闭分类选择" }).click();
  await fitsViewport(page);
});

for (const state of ["loading", "empty", "error"] as const) {
  test(`transactions ${state}`, async ({ page, app }) => {
    await app.open("/transactions", state);
    if (state === "loading")
      await expect(page.getByRole("status").first()).toBeVisible();
    if (state === "empty")
      await expect(
        page.getByRole("heading", { name: "暂无交易" }),
      ).toBeVisible();
    if (state === "error")
      await expect(page.getByRole("alert").first()).toContainText("加载失败");
    await expect(page).toHaveScreenshot(`transactions-${state}.png`, {
      fullPage: true,
    });
    if (state === "error") {
      app.recover();
      await page.getByRole("button", { name: "重试" }).first().click();
      await page.getByRole("button", { name: "重试" }).click();
      await expect(page.getByText("示例消费", { exact: true })).toBeVisible();
    }
    if (state === "empty") {
      await page.getByRole("link", { name: "记一笔" }).first().click();
      await expect(
        page.getByRole("heading", { name: "新增交易" }),
      ).toBeVisible();
    }
  });
}

test("reduced viewport keeps editor field and save action reachable", async ({
  page,
  app,
}) => {
  await app.open("/transactions/7");
  await expect(page.getByRole("heading", { name: "示例消费" })).toBeVisible();
  // Exercises VisualViewport resize; this is not an emulated iOS software keyboard.
  await expect(page.locator("html")).toHaveCSS(
    "--visual-height",
    `${page.viewportSize()!.height}px`,
  );
  const notes = page.getByRole("textbox", { name: "备注", exact: true });
  await notes.click();
  await expect(notes).toBeFocused();
  await page.setViewportSize({ width: 390, height: 420 });
  await expect(page.locator("html")).toHaveCSS("--visual-height", "420px");
  await notes.fill("自动化输入");
  await expect(notes).toBeFocused();
  await expect(notes).toBeInViewport();
  await reachable(page.getByRole("button", { name: "保存修改" }));
  await fitsViewport(page);
  await expect(page).toHaveScreenshot("editor-reduced-viewport.png");
});

// Deliver the rejected write over loopback HTTP: WebKit can finish an
// intercepted 400 response while its page-side body reader remains pending.
const validationTest = test.extend<{ validationEndpoint: string }>({
  validationEndpoint: async ({}, use) => {
    const server = createServer((request, response) => {
      request.resume();
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Headers", "*");
      response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      if (request.method === "OPTIONS") {
        response.writeHead(204).end();
        return;
      }
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ code: "VALIDATION", message: "保存失败" }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      await use(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/rejected-save`,
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
});

validationTest(
  "account create keeps input after failure and saves on retry",
  async ({ page, app, validationEndpoint }) => {
    await app.open("/accounts");
    await page.getByRole("button", { name: "新增科目" }).click();
    await sheetFitsViewport(page.getByRole("dialog"));
    await page.getByRole("combobox", { name: "类型", exact: true }).click();
    const typeSheet = page.getByRole("dialog", { name: "选择类型" });
    await sheetFitsViewport(typeSheet);
    await reachable(
      typeSheet.getByRole("button", { name: "资产", exact: true }),
    );
    await typeSheet.getByRole("button", { name: "资产", exact: true }).click();
    await expect(typeSheet).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "类型", exact: true }),
    ).toBeFocused();
    await page.getByRole("textbox", { name: "科目 ID" }).fill("10102");
    await page.getByRole("textbox", { name: "科目名称" }).fill("日常账户");
    await page
      .getByRole("textbox", { name: "子类", exact: true })
      .fill("现金及等价物");
    let saveAttempts = 0;
    await page.route("**/test-api/rpc/save_account", (route) => {
      saveAttempts++;
      if (saveAttempts > 1) return route.fallback();
      return route.continue({ url: validationEndpoint });
    });
    const rejected = page.waitForResponse(
      (response) =>
        response.url() === validationEndpoint ||
        new URL(response.url()).pathname === "/test-api/rpc/save_account",
    );
    await page.getByRole("button", { name: "保存科目" }).click();
    const response = await rejected;
    expect(response.status()).toBe(400);
    expect(await response.finished()).toBeNull();
    await expect(page.getByRole("alert")).toContainText("保存失败");
    await expect(page.getByRole("textbox", { name: "科目名称" })).toHaveValue(
      "日常账户",
    );
    await expect(page).toHaveScreenshot("account-save-error.png");
    const request = page.waitForRequest("**/test-api/rpc/save_account");
    await page.getByRole("button", { name: "保存科目" }).click();
    expect((await request).postDataJSON()).toMatchObject({
      p_id: null,
      p_payload: { name: "日常账户", type: "资产" },
    });
    expect(saveAttempts).toBe(2);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  },
);

test("refund and transaction filter sheets fit short and landscape viewports", async ({
  page,
  app,
}) => {
  await app.open("/transactions/7");
  await page.getByRole("button", { name: "交易操作" }).click();
  await page.getByRole("button", { name: "补记退款", exact: true }).click();
  const refund = page.getByRole("dialog", { name: "补记退款" });
  await sheetFitsViewport(refund);
  await page.setViewportSize({ width: 568, height: 320 });
  await sheetFitsViewport(refund);
  await refund.getByRole("button", { name: "取消", exact: true }).click();
  await expect(refund).toHaveCount(0);
  await app.open("/transactions");
  await page.getByRole("button", { name: "展开筛选", exact: true }).click();
  await page.getByRole("combobox", { name: "科目", exact: true }).click();
  await sheetFitsViewport(page.getByRole("dialog", { name: "选择科目" }));
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "交易状态", exact: true }).click();
  await sheetFitsViewport(page.getByRole("dialog", { name: "选择交易状态" }));
  await page.keyboard.press("Escape");
  await fitsViewport(page);
});

for (const route of [
  { name: "overview", path: "/", empty: "未设置现金账户" },
  { name: "accounts", path: "/accounts", empty: "没有匹配的科目" },
  {
    name: "editor",
    path: "/transactions/7",
    empty: "记录不存在或没有访问权限。",
  },
]) {
  for (const state of ["loading", "empty", "error"] as const) {
    test(`${route.name} ${state}`, async ({ page, app }) => {
      await app.open(route.path, state);
      if (state === "loading")
        await expect(page.getByRole("status").first()).toBeVisible();
      if (state === "empty")
        await expect(
          page.getByText(route.empty, { exact: true }),
        ).toBeVisible();
      if (state === "error")
        await expect(page.getByRole("alert").first()).toContainText("加载失败");
      await fitsViewport(page);
      await expect(page).toHaveScreenshot(`${route.name}-${state}.png`, {
        fullPage: true,
      });
      if (route.name === "editor" && state === "error") {
        app.recover();
        await page.getByRole("button", { name: "重试" }).click();
        await expect(
          page.getByRole("heading", { name: "示例消费" }),
        ).toBeVisible();
      }
    });
  }
}

test("account hierarchy searches by ID, edits identity and deletes after confirmation", async ({
  page,
  app,
}) => {
  await app.open("/accounts");
  await page.getByRole("searchbox", { name: "搜索科目" }).fill("10101");
  const row = page.getByRole("button", { name: /10101.*银行卡/ });
  await expect(row).toBeVisible();
  await row.click();
  const dialog = page.getByRole("dialog", { name: "修改科目" });
  await sheetFitsViewport(dialog);
  await dialog.getByRole("textbox", { name: "科目 ID" }).fill("10102");
  const saved = page.waitForRequest("**/test-api/rpc/save_account");
  await dialog.getByRole("button", { name: "保存科目" }).click();
  expect((await saved).postDataJSON()).toMatchObject({
    p_id: 10101,
    p_payload: { id: 10102 },
  });
  await expect(dialog).toHaveCount(0);
  await row.click();
  page.once("dialog", (d) => d.accept());
  const deleted = page.waitForRequest("**/test-api/rpc/delete_account");
  await dialog.getByRole("button", { name: "删除科目" }).click();
  expect((await deleted).postDataJSON()).toEqual({ p_id: 10101 });
  await expect(dialog).toHaveCount(0);
});

test("account sheet keeps actions visible in a short dark viewport", async ({
  page,
  app,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 375, height: 420 });
  await app.open("/accounts");
  await page.getByRole("button", { name: "新增科目", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新增科目" });
  await sheetFitsViewport(dialog);
  await reachable(dialog.getByRole("button", { name: "保存科目" }));
  await reachable(dialog.getByRole("button", { name: "取消", exact: true }));
  const notes = dialog.getByRole("textbox", { name: "说明", exact: true });
  await notes.fill("保留未保存输入");
  await reachable(notes);
  await expect(
    dialog.getByRole("heading", { name: "新增科目" }),
  ).toBeInViewport();
  // Focus scrolling can stop before the form's bottom padding. Capture its end.
  await dialog.locator(".form-sheet-body").evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight;
  });
  await expect(page).toHaveScreenshot("account-short-dark.png");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("searchbox", { name: "搜索科目" }).fill("不存在");
  await page.getByRole("button", { name: "清空搜索" }).click();
  await expect(page.getByRole("searchbox", { name: "搜索科目" })).toHaveValue(
    "",
  );
});

test("dense profit dates remain separated on a narrow phone", async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/test-api/income_statement?*", (route) =>
    route.fulfill({
      json: Array.from({ length: 16 }, (_, i) => {
        const date = `2026-09-${String(i + 1).padStart(2, "0")}`;
        return {
          occurred_at: `${date}T00:00:00Z`,
          date,
          type: "收入",
          subtype: "工资",
          income: i === 12 ? "14000" : "0",
          expense: i === 0 ? "-3.66" : "100",
          profit: i === 12 ? "13900" : "-100",
          amount: i === 12 ? "14000" : "0",
        };
      }),
    }),
  );
  await app.open("/?view=profit");
  const chart = page.getByRole("img", { name: "本期收入及支出趋势" });
  await expect(chart).toBeVisible();
  const labels = await chart.locator('text[y="202"]').evaluateAll((elements) =>
    elements.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    }),
  );
  expect(labels.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < labels.length; i++)
    expect(labels[i].left - labels[i - 1].right).toBeGreaterThanOrEqual(8);
  await expect(page).toHaveScreenshot("profit-dense.png", { fullPage: true });
});

validationTest(
  "inline account failure retains input in a short dark sheet and retries",
  async ({ page, app, validationEndpoint }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await app.open("/transactions/7");
    await page.getByRole("combobox", { name: "账户", exact: true }).click();
    await page.getByRole("button", { name: "新增账户", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新增账户", exact: true });
    await dialog.getByRole("textbox", { name: "账户 ID" }).fill("10102");
    await dialog.getByRole("textbox", { name: "账户名称" }).fill("旅行钱包");
    let attempts = 0;
    await page.route("**/test-api/rpc/save_account", (route) =>
      ++attempts === 1
        ? route.continue({ url: validationEndpoint })
        : route.fallback(),
    );
    await dialog.getByRole("button", { name: "保存并选中" }).click();
    await expect(dialog.getByRole("alert")).toContainText("保存失败");
    await expect(dialog.getByRole("textbox", { name: "账户名称" })).toHaveValue(
      "旅行钱包",
    );
    await page.setViewportSize({ width: 375, height: 480 });
    await sheetFitsViewport(dialog);
    const notes = dialog.getByRole("textbox", { name: "说明", exact: true });
    await notes.focus();
    await notes.fill("随身账户");
    await reachable(notes);
    await reachable(dialog.getByRole("button", { name: "保存并选中" }));
    // Focus can leave the short form one pixel from its end in WebKit.
    // Anchor the screenshot at the form's scroll boundary.
    const body = dialog.locator(".form-sheet-body");
    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight - element.clientHeight;
    });
    await expect(page).toHaveScreenshot("inline-account-dark-short.png");
    await dialog.getByRole("button", { name: "保存并选中" }).click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toBe(2);
    await expect(
      page.getByRole("combobox", { name: "账户", exact: true }),
    ).toContainText("旅行钱包");
  },
);

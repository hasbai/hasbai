import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_CLASH_TEMPLATE } from "../shared/clash-preset";
async function fixture(
  page: Page,
  { admin = true, empty = false, fail = false, delay = false, clashDelay = false } = {},
) {
  let failure = fail;
  const user = {
    id: 1,
    email: "member@example.com",
    auth0_sub: "auth0|member",
    enabled: 1,
    speed_limit: 100,
    device_limit: 0,
    expired_at: null,
    transfer_enable: 107374182400,
    upload: 1073741824,
    download: 4294967296,
  };
  const client = {
    server: "node.example.com",
    port: 443,
    security: "tls",
    network: "tcp",
  };
  const nodes = empty
    ? []
    : [
        {
          id: 1,
          name: "东京节点",
          node_type: "vless",
          enabled: 1,
          user_count: 1,
          config_revision: 1,
          users_revision: 1,
          config_template_id: null,
          client_json: JSON.stringify(client),
        },
      ];
  const users = empty ? [] : [user];
  const templates = empty
    ? []
    : [
        {
          id: 1,
          name: "VLESS 标准模板",
          protocol: "vless",
          description: "主节点",
          template_json: '{"server_port":443,"network":"tcp"}',
        },
      ];
  let clashSettings = {
    template_yaml: "proxies: []\nproxy-groups:\n  - name: 节点选择\n    type: select\n    proxies: [本站节点, DIRECT]\nrules: [\"MATCH,节点选择\"]\n",
    override_yaml: "",
  };
  const assignments = new Set([1]);
  let sub = "0123456789abcdef0123456789abcdef";
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      p = url.pathname;
    let data: unknown = { ok: true };
    if (delay && p === "/api/me") return;
    if (clashDelay && p === "/api/admin/clash") return;
    if (failure) {
      await route.fulfill({ status: 503, json: { message: "服务暂时不可用" } });
      return;
    }
    const body = req.postDataJSON() ?? {};
    if (p === "/api/me/rotate") sub = "abcdef0123456789abcdef0123456789";
    if (p === "/api/me" || p === "/api/me/rotate")
      data = {
        admin,
        user,
        nodes,
        subscription_url: empty ? null : `http://127.0.0.1:4175/sub/${sub}`,
      };
    else if (p === "/api/admin/nodes" && req.method() === "GET")
      data = { nodes };
    else if (p === "/api/admin/nodes" && req.method() === "POST") {
      nodes.push({
        id: 2,
        user_count: 0,
        config_revision: 1,
        users_revision: 1,
        ...body,
        client_json: JSON.stringify(body.client),
      });
      data = { id: 2 };
    } else if (p === "/api/admin/nodes/1" && req.method() === "PATCH") {
      Object.assign(nodes[0], body);
      data = { node: nodes[0] };
    } else if (p === "/api/admin/nodes/1" && req.method() === "DELETE")
      nodes.splice(0, 1);
    else if (p === "/api/admin/nodes/1")
      data = {
        node: {
          ...nodes[0],
          token: "node-test-key",
          config: { server_port: 443 },
          client,
          assigned_users: assignments.has(1) ? users : [],
        },
      };
    else if (p === "/api/admin/nodes/1/users/1") {
      if (req.method() === "DELETE") assignments.delete(1);
      else assignments.add(1);
    } else if (p === "/api/admin/users") data = { users };
    else if (p === "/api/admin/users/1") {
      Object.assign(user, body);
      data = { user };
    } else if (p === "/api/admin/clash") {
      if (req.method() === "PUT") clashSettings = body;
      data = clashSettings;
    } else if (p === "/api/admin/templates" && req.method() === "GET")
      data = { templates };
    else if (p === "/api/admin/templates" && req.method() === "POST") {
      templates.push({
        id: 2,
        ...body,
        template_json: JSON.stringify(body.template),
      });
      data = { id: 2 };
    } else if (p.endsWith("/render"))
      data = {
        config: { server_port: 443, network: "tcp" },
        protocol: "vless",
      };
    else if (p === "/api/admin/templates/1" && req.method() === "PATCH")
      Object.assign(templates[0], body, {
        template_json: JSON.stringify(body.template),
      });
    else if (p === "/api/admin/templates/1" && req.method() === "DELETE")
      templates.splice(0, 1);
    else if (p === "/api/admin/reports")
      data = {
        reports: empty
          ? []
          : [
              {
                id: 1,
                node_id: 1,
                event: "report.traffic",
                payload_json: '{"1":[1024,4096]}',
                created_at: 1790553600,
              },
            ],
      };
    await route.fulfill({ json: data });
  });
  return { recover: () => (failure = false), fail: () => (failure = true) };
}
async function open(page: Page, hash = "subscription") {
  await page.goto("/e2e/index.html#" + hash);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}
async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const link of await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link")
    .all()) {
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  for (const table of await page.locator(".table-scroll").all()) {
    expect(await table.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
  }
}
test("panel pages and states", async ({ page }) => {
  await fixture(page);
  await open(page);
  await fits(page);
  await expect(page).toHaveScreenshot("subscription.png", { fullPage: true });
  await page.getByRole("button", { name: "隐藏用量" }).click();
  await page.getByRole("button", { name: "切换深色" }).click();
  await expect(page).toHaveScreenshot("subscription-dark-hidden.png", {
    fullPage: true,
  });
  await page.getByRole("button", { name: "显示用量" }).click();
  await page.getByRole("button", { name: "切换浅色" }).click();
  for (const [name, shot] of [
    ["总览", "overview.png"],
    ["节点", "nodes.png"],
    ["配置模板", "templates.png"],
    ["用户", "members.png"],
    ["报告", "reports.png"],
  ]) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
    await fits(page);
    await expect(page).toHaveScreenshot(shot, { fullPage: true });
  }
});
test("node template and membership operations", async ({ page }) => {
  const f = await fixture(page);
  await open(page, "nodes");
  await page.getByRole("button", { name: "编辑节点 东京节点" }).click();
  await expect(page.getByLabel("节点名称")).toHaveValue("东京节点");
  await expect(page).toHaveScreenshot("node-editor.png", { fullPage: true });
  await page.getByLabel("配置模板", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "载入模板" }).click();
  await expect(page.getByLabel("服务端配置（JSON）")).toHaveValue(
    /server_port/,
  );
  await page.getByLabel("节点名称").fill("大阪节点");
  f.fail();
  await page.getByRole("button", { name: "保存节点" }).click();
  await expect(page.getByRole("alert")).toContainText("服务暂时不可用");
  await expect(page.getByLabel("节点名称")).toHaveValue("大阪节点");
  await expect(page).toHaveScreenshot("save-error.png", { fullPage: true });
  f.recover();
  await page.getByRole("button", { name: "保存节点" }).click();
  await expect(
    page.getByRole("button", { name: "编辑节点 大阪节点" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "编辑节点 大阪节点" }).click();
  await page.getByRole("button", { name: "移除", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "分配", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "分配", exact: true }).click();
  await page.getByRole("button", { name: "删除节点" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
  await expect(page.getByLabel("节点名称")).toHaveValue("大阪节点");
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("link", { name: "配置模板", exact: true }).click();
  await page.getByRole("button", { name: "编辑模板 VLESS 标准模板" }).click();
  await expect(page).toHaveScreenshot("template-editor.png", {
    fullPage: true,
  });
  await page.getByLabel("模板名称").fill("新模板名称");
  await page.getByRole("button", { name: "保存模板" }).click();
  await expect(
    page.getByRole("button", { name: "编辑模板 新模板名称" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clash 订阅模板" }).click();
  await expect(page.getByLabel("Clash 配置模板（YAML）")).toHaveValue(/本站节点/);
  const custom = await page.getByLabel("Clash 配置模板（YAML）").inputValue();
  await page.getByLabel("管理员覆盖项（YAML）").fill("dns:\n  enable: true");
  await page.getByRole("button", { name: "载入内置分流模板" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Clash 配置模板（YAML）")).toHaveValue(DEFAULT_CLASH_TEMPLATE);
  await expect(page.getByLabel("管理员覆盖项（YAML）")).toHaveValue("dns:\n  enable: true");
  // Loading a preset changes only the editor. Discarding it preserves the saved YAML.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "Clash 订阅模板" }).click();
  await expect(page.getByLabel("Clash 配置模板（YAML）")).toHaveValue(custom);
  await page.getByRole("button", { name: "载入内置分流模板" }).click();
  const yamlEditor = page.getByLabel("Clash 配置模板（YAML）");
  expect(await yamlEditor.evaluate((element) => element.clientHeight)).toBeLessThan(400);
  expect(await yamlEditor.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await yamlEditor.focus();
  await page.keyboard.press("Control+End");
  await expect.poll(() => yamlEditor.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press("Control+Home");
  await fits(page);
  await expect(page).toHaveScreenshot("clash-template-editor.png", { fullPage: true });
  await page.getByRole("button", { name: "切换深色" }).click();
  await expect(page).toHaveScreenshot("clash-template-dark.png", { fullPage: true });
  await page.getByRole("button", { name: "切换浅色" }).click();
  await page.getByLabel("管理员覆盖项（YAML）").fill("dns:\n  enable: true");
  f.fail();
  await page.getByRole("button", { name: "保存模板" }).click();
  await expect(page.getByRole("alert")).toContainText("服务暂时不可用");
  await expect(page.getByLabel("管理员覆盖项（YAML）")).toHaveValue("dns:\n  enable: true");
  f.recover();
  await page.getByRole("button", { name: "保存模板" }).click();
  await page.getByRole("button", { name: "Clash 订阅模板" }).click();
  await expect(page.getByLabel("管理员覆盖项（YAML）")).toHaveValue("dns:\n  enable: true");
  await expect(page.getByLabel("Clash 配置模板（YAML）")).toHaveValue(DEFAULT_CLASH_TEMPLATE);
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("link", { name: "用户", exact: true }).click();
  await page
    .getByRole("button", { name: "编辑用户 member@example.com" })
    .click();
  await expect(page).toHaveScreenshot("member-editor.png", { fullPage: true });
  await page.getByLabel("流量额度（GB，0 为不限）").fill("200");
  await page.getByRole("button", { name: "保存用户" }).click();
  await expect(page.getByText("5 GB / 200 GB")).toBeVisible();
});
test("Clash template loading and fetch error recovery", async ({ page }) => {
  await fixture(page, { clashDelay: true });
  await open(page, "templates");
  await page.getByRole("button", { name: "Clash 订阅模板" }).click();
  await expect(page.getByRole("status", { name: "正在加载 Clash 订阅模板" })).toBeVisible();
  await fits(page);
});
test("Clash template fetch error can retry", async ({ page }) => {
  const f = await fixture(page);
  await open(page, "templates");
  f.fail();
  await page.getByRole("button", { name: "Clash 订阅模板" }).click();
  await expect(page.getByRole("alert")).toContainText("服务暂时不可用");
  await expect(page).toHaveScreenshot("clash-template-error.png", { fullPage: true });
  f.recover();
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByLabel("Clash 配置模板（YAML）")).toHaveValue(/本站节点/);
});
test("normal user subscription rotation and restricted navigation", async ({
  page,
}) => {
  await fixture(page, { admin: false });
  await open(page);
  await expect(
    page.getByRole("link", { name: "节点", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("客户端格式").selectOption("clash");
  await expect(page.locator("code")).toContainText("format=clash");
  await page.getByRole("button", { name: "重置链接" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "确认" }).click();
  await expect(page.locator("code")).toContainText("/sub/abcdef");
  await page.goto("/e2e/index.html#nodes");
  await expect(
    page.getByRole("heading", { name: "需要管理员权限" }),
  ).toBeVisible();
});
test("empty error loading and keyboard states", async ({ page }) => {
  const f = await fixture(page, { empty: true });
  await open(page, "nodes");
  await expect(
    page.getByRole("heading", { name: "尚未添加节点" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("empty.png", { fullPage: true });
  f.fail();
  await page.getByRole("button", { name: "刷新页面" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveScreenshot("error.png", { fullPage: true });
  f.recover();
  await page.getByRole("button", { name: "重试" }).click();
  await page.getByRole("button", { name: "新增节点" }).click();
  const name = page.getByLabel("节点名称");
  const restingShadow = await name.evaluate(el => getComputedStyle(el).boxShadow);
  await name.focus();
  await expect(name).toHaveCSS("outline-offset", "-2px");
  await expect(name).toHaveCSS("outline-width", "2px");
  await expect(name).toHaveCSS("box-shadow", restingShadow);
  await page.keyboard.type("键盘节点");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("协议", { exact: true })).toBeFocused();
  await expect(page.getByLabel("协议", { exact: true })).toHaveCSS("outline-offset", "-2px");
  await expect(page.getByLabel("协议", { exact: true })).toHaveCSS("outline-width", "2px");
  await fits(page);
});
test("initial loading", async ({ page }) => {
  await fixture(page, { delay: true });
  await page.goto("/e2e/index.html");
  await expect(
    page.getByRole("status", { name: "正在加载", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("loading.png", { fullPage: true });
});

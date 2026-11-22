# 财务测试契约

路径相对 `apps/financial`。执行命令、固定 Linux 截图、CI 与交付流程见 [共享 TESTING](../TESTING.md)。

## 业务与覆盖率

- **单测**：校验 Decimal、日期半开区间、借贷分配、同笔退款、原 ID 与冲突保存。也覆盖不确定保存、分页筛选、请求复用及 PWA 生命周期。API 参数、十进制字符串与游标可以使用精确断言。不得按 CSS 类、源码文本或私人账本行数写断言。
- **覆盖率**：Vitest v8 覆盖业务 TS 与 Svelte，排除测试、夹具、纯类型与生成的基础组件。覆盖范围不得排除生产入口、认证与外壳。门槛见 `vite.config.ts`。浏览器回归与 Vitest 覆盖率分开报告。
- **数据库与真实 API**：脚本入口见 [DATABASE](DATABASE.md#验证与切换)。

## 设备与浏览器矩阵

| 项目 | 覆盖范围 |
| --- | --- |
| `iphone`（390px Chromium） | 完整移动流程。正常、加载、空与错误状态。隐私、深色、新增失败重试。缩口焦点、保存按钮、48px 触控命中与中心可点 |
| `iphone-se`（320px Chromium） | 窄屏正常流程。深色隐私。编辑与二级科目选择 |
| Pixel 7（Chromium） | 较大手机视口关键移动流程 |
| 桌面 Chromium | 侧栏、Dialog、键盘开关、拒绝丢弃保留输入 |

`e2e/index.html` 复用 `src/test/Harness.svelte`、Shell、路由、QueryClient 与真实 Repository，HTTP 返回合成数据。`prepare-browser-build.mjs` 先构建 `dist`，再编译 `dist-e2e` 并注入生产压缩 CSS 经 `vite preview` 运行（夹具不进入 `dist`）。所有项目只使用 Chromium，不代表 Safari/WebKit、系统软键盘、刘海安全区或真机 PWA 安装（e2e 阻止注册 SW）。

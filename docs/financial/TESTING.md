# 财务测试契约

源码、脚本、报告及浏览器入口路径均相对 `apps/financial`。本地执行命令、固定 Linux 截图、CI 与交付步骤只在[共享测试规范](../TESTING.md)维护。

## 业务与覆盖率

检查 Decimal、日期半开区间、借贷分配、同笔退款及原 ID。保留冲突、不确定保存、分页/筛选、请求复用及 PWA 生命周期检查。API 查询参数、numeric 字符串、分页游标及请求去重数量属于现有契约，可使用精确断言；不按 CSS 类、源代码文本或当前私人账本行数写断言。

Vitest v8 范围含业务 TS/Svelte，排除测试、fixture、纯类型及生成的基础组件；生产入口/认证/外壳不因难测而排除。覆盖率门槛以 `vite.config.ts` 的配置为准。WebKit 不提供 V8 兼容覆盖数据，不伪造合并覆盖率，不以重复用例抬高数字或为通过而扩大排除范围。

数据库基础与余额历史脚本独立可运行，共同三表/权限检查是入口前提，不抽成通用框架。已执行迁移中删除旧包装对象的检查保留。真实 API 与数据库验证入口见[DATABASE](DATABASE.md#验证与切换)。

## 设备与浏览器入口

- iPhone 13 / WebKit：完整移动流程与各业务页的正常、加载、空、错误状态；隐私、深色、科目新增失败重试、缩小视口下焦点与保存按钮。
- iPhone SE / WebKit：窄屏正常流程、深色隐私、编辑与二级科目选择。
- Pixel 7 / Chromium：同一移动关键流程的另一浏览器引擎。
- 桌面 Chromium：侧栏、Dialog、键盘打开/关闭、拒绝丢弃后的输入保留。

主矩阵集中在 WebKit，状态组合不在所有设备重复。关键操作额外检查 48px 触控区域、视口内可见与中心命中，避免单纯把现有截图照收为基线。选择器优先 role/label，不复制 DOM 树或给每个控件加 test-id。

`e2e/index.html`是独立测试入口，复用`src/test/Harness.svelte`、Shell、路由、QueryClient和真正的Repository；HTTP层返回合成数据，非测试服务请求直接失败。CI先正常生产构建dist，再以e2e mode将测试入口单独编译到dist-e2e。`prepare-browser-build.mjs`用dist中的原样压缩CSS替换测试入口stylesheet，浏览器通过vite preview读取静态产物，不能再用Vite开发服务代替生产CSS。日期、时区、语言、动画、主题固定；入口与fixture不进入生产dist，生产App没有跳过认证的开关。

Playwright iPhone 项目是 WebKit 设备模拟，不是 iOS Safari 真机。缩小 viewport 验证 VisualViewport/焦点滚动，不声称验证系统软键盘、刘海安全区实际值、PWA 安装或系统返回手势。生产 Service Worker 仍由现有生命周期单测覆盖，此浏览器套件阻止注册 SW 以保证请求隔离。

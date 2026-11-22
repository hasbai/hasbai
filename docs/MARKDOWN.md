# 共享 Markdown 契约

实现与阅读组件位于 `packages/markdown`。博客的文章、手记、独立页面与编辑预览共用该包。通用扩展能力在共享包维护，应用只处理内容元数据与编辑流程。

## 语法、渲染与编辑保真

- **基础与扩展语法**：支持 GFM（表格、任务列表、删除线、自动链接）与 `$…$`/`$$…$$` KaTeX。扩展语法支持 Callout（`> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]`）、同名 Admonition（`:::note` 格式）、YAML Frontmatter、脚注 `[^id]` 与文献引用 `[@id]`。
- **文献与 Frontmatter**：文献由 Frontmatter 的 `references` 数组定义（字段为 `id`、`author`、`title`、`year`、`url`），输出编号参考资料与回链。未定义引用保留原文，不得伪造来源。Frontmatter 解析为元数据并从正文及摘要排除，不得自动修改数据库的标题、slug、摘要、标签或发布状态。
- **图表扩展**：`mermaid`、`d2`、`markmap` 围栏在浏览器按需加载本地依赖。服务端首屏保留源码与完整正文。D2 使用官方 WASM Worker（同一编译器请求串行执行）。Mermaid 固定 `strict` 安全级别。D2 与 Mermaid 的 SVG 在图片上下文显示。Markmap 提供缩放、适应与拖动，不执行作者脚本，不加载外部插件，节点 HTML 经过清理。单图失败显示局部错误并保留源码。主题切换触发重新渲染，导航与预览更新清理图实例与临时图片 URL。
- **编辑保真与安全**：普通 Markdown 保留富文本编辑。含扩展语法的文档使用源码与统一预览，防止 Tiptap 序列化丢失语法。保存、重开与切换预览不得改写 Markdown。系统拒绝原始 HTML 与危险 URL。KaTeX 设 `trust: false`，先清理 Markdown 再生成受控数学标记。全部扩展的夹具、源码保真与浅深色截图登记在 `markdown-extensions` 场景。

## 运行时与核验

YAML 使用依赖提供的浏览器 ESM 入口，防止 Cloudflare SSR 产物注入 `createRequire(import.meta.url)`。博客生产 `build` 内的 workerd 启动检查验证该约束（实现见 `apps/blog/scripts/check-worker-startup.mjs`）。

扩展夹具与源码保真检查在博客完整单测中执行，并由 `packages/markdown/src` 的真实渲染器验证。图表与预览的设备证据登记在博客 `visual-coverage.json`。本地检查与 Linux 截图步骤以 [TESTING](TESTING.md) 为准。早期审阅证据见 [博客历史交付](blog/history/DELIVERY.md)。旧检查数量不是当前覆盖承诺。

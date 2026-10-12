# 共享 Markdown 契约

实现与阅读组件位于 `packages/markdown`，由博客的文章、手记、独立页面和编辑预览共用。通用扩展能力在共享包维护，应用只处理内容元数据和编辑流程。

## 语法、渲染与编辑保真

支持 GFM：表格、任务列表、删除线、自动链接。扩展支持 `$…$` / `$$…$$` KaTeX、`> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]` Callout、`:::note` 等同名 Admonition、YAML Frontmatter、脚注 `[^id]` 与文献引用 `[@id]`。文献由 Frontmatter 的 `references` 数组定义，字段为 `id`、`author`（字符串）、`title`、`year`、`url`，输出编号参考资料与回链；未定义引用保留原文，不伪造来源。Frontmatter 解析为元数据、从正文和自动摘要排除，不自动修改数据库的标题、slug、摘要、标签或发布状态。

`mermaid`、`d2`、`markmap` 围栏在浏览器按需加载本地依赖；服务端首屏保留源码与其余完整正文。D2 使用官方 WASM Worker，同一编译器的请求串行执行；Mermaid 固定 strict 安全级别；两者的 SVG 在图片上下文显示。

Markmap 提供缩放、适应和拖动，不执行作者脚本、不加载外部插件资源，节点 HTML 经过清理。单图失败显示局部错误并保留源码；主题切换重新渲染，导航和预览更新清理图实例及临时图片 URL。

普通 Markdown 保留富文本编辑。包含扩展语法的文档使用源码和统一预览，避免 Tiptap 序列化丢失语法；保存、重开与切换预览不改写 Markdown。原始 HTML 与危险 URL 仍拒绝，KaTeX `trust: false`，先清理 Markdown 再生成受控数学标记。全部扩展的夹具、源码保真及手机/桌面浅深色截图登记在 `markdown-extensions` 场景。

## 运行时与核验

YAML 使用依赖提供的浏览器 ESM 入口，避免 Cloudflare SSR 产物注入 Node `createRequire(import.meta.url)`。博客生产 build 内的 workerd 启动检查验证该约束；实现入口见 `apps/blog/scripts/check-worker-startup.mjs`。

扩展 fixture 和源码保真检查在博客完整单测中执行，并通过 `packages/markdown/src` 的真实渲染器验证，图表/预览的设备证据登记在博客 `visual-coverage.json`。本地检查和 Linux 截图步骤以[TESTING](TESTING.md)为准；先前审阅证据见[博客历史交付](blog/history/DELIVERY.md)，旧检查数量不是当前覆盖承诺。

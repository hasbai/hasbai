# 博客当前状态

按当前 `main` 实现与已有证据整理。业务行为以 [架构](ARCHITECTURE.md)、[缓存](CACHE.md) 与 [共享 Markdown](../MARKDOWN.md) 为准。

## 已实现

- 公开 SSR、文章与手记混排、时间线、标签、独立页面、旧链接重定向、R2 公开快照缓存。编辑室、事务保存、冲突保护、图片转发与匿名隔离。
- 共享 Auth0 登录、`blog.all:all` 门禁、站点名与已授权页脚文案。Hono `/api/mcp` 与 `mcp.hasbai.xyz/mcp` Portal。
- 共享 Markdown 扩展（数学、Callout、Admonition、Frontmatter、脚注、文献、Mermaid、D2、Markmap、源码保真与 YAML SSR 兼容）。`build` 内置真实 workerd 启动检查。
- 多语言改造：统一 `content` 与 `translation` 表、enum、JSONB 标签、locale 路由、`i18next` 界面、KV 语言配置、发布自动补译与手动覆盖。

## 证据与待核验

- 多语言迁移、译文 RLS、并发冲突 SQL 测试与真实 `dynamic/translate` 已在隔离 Neon 分支验证。生产迁移与线上状态分别核验。
- 历史迁移、API 与 Linux 截图见 [DELIVERY](history/DELIVERY.md)（含 2026-10-13 Portal 验收）。Google OAuth 品牌核对已有记录，但无审核通过结论。第三方账号完整登录、Search Console 与 iOS 真机体验待独立验证。

# 博客当前状态

按当前 main 的实现与已有证据整理，业务行为以[架构](ARCHITECTURE.md)和[共享 Markdown](../MARKDOWN.md)为准。

## 已实现

公开 SSR、文章/手记混排、时间线、标签、独立页面和旧链接重定向；编辑室、事务文章保存、冲突保护、R2 图片上传与匿名读取隔离。统一登录、permission 门禁、站点名及首页已授权页脚文案已在代码中落地。

共享 Markdown 已支持数学、Callout/Admonition、Frontmatter、脚注/文献和 Mermaid/D2/Markmap；扩展源码保真与 Cloudflare YAML SSR 兼容修复分别合入 PR #64 / #65。博客 `build` 包含真实 workerd 启动检查；本次文档整理没有重跑这些业务验收。

Hono 提供博客接口及 MCP。`mcp.hasbai.xyz/mcp` Portal 允许任意用户登录读取公开内容；管理员经同一 Portal 增删改查。权限使用 `blog.all:all`，旧权限不兼容。验收记录见[DELIVERY](history/DELIVERY.md#hono-mcp-portal-与权限统一2026-10-13)。

多语言改造已实现统一 content/translation 存储、enum 类型、JSONB 标签名称、locale 路由、i18next 界面、KV 语言配置和 AI 翻译。发布补齐缺失译文；编辑室手动翻译直接覆盖，保留来源和目标冲突检测。

## 证据与待核验

多语言改造已在隔离 Neon 分支验证迁移及原文校验值，并通过译文 RLS 和并发冲突 SQL 测试。真实 dynamic/translate 请求成功。生产迁移、最终 PR CI 和部署分别核验，不能由隔离测试结果推断。

历史内容迁移、匿名/管理员 API 和 Linux 截图证据见[DELIVERY](history/DELIVERY.md)。Hono MCP、Portal 登录与权限统一的 CI、自动部署及真实调用已登记；其他功能不由合并状态推断生产已验收。

Google OAuth 已有项目品牌/域名核对记录，但没有 Google 审核通过结论；第三方账号完整登录、Search Console 所有权与 iOS 真机体验未由现有记录证明。文档整理不重新提交审核或修改线上政策。

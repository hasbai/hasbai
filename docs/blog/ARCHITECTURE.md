# 博客架构

边界与路由见[博客入口](README.md)，登录授权见[AUTHORIZATION](../AUTHORIZATION.md)，共享视觉见[DESIGN](../DESIGN.md)。源码相对 `apps/blog`，共享包与迁移相对仓库根。

## 结构与主题

SvelteKit 负责 SSR，Hono 负责 `/api/**` 与 `/images/**`，`hooks.server.ts` 分派请求并设安全头；复用 `packages/ui`、`packages/auth`、`packages/data`、`packages/markdown`。主题为近白 neutral 底、深灰正文、少量玫瑰强调、衬线正文与紧凑导航；桌面花瓣首屏用轻量 SVG，水合后交由 Canvas（移动端及减弱动效偏好停用）。站点及无障碍名称引用 `site.name`（北极小站）。

## 数据与权限

- **内容与译文模型**：`0010_translations.sql` 移除表继承，`public.content` 存语言无关元数据（UUID、`kind`、`source_locale`、`slug`、`sequence`、封面、`status`、发布时间），文章/手记/独立页面共用；`public.translation` 以 `(content_id, locale)` 存 `title`、`excerpt`、`markdown`、`updated_at`（直接覆盖，不存多版本，匿名 RLS 仅允许已发布且到期内容）。`public.tag.translations` 存语言映射 JSONB（`zh-CN` 回退），`public.article_tag` 关联文章与标签。
- **路由与多语言**：公开路径 `/articles/:slug`、`/notes/:sequence` 与独立页面根路径（`/contents/:id` 与 `legacy_path` 永久重定向；独立页面不占功能路径或语言前缀，不进首页/时间线）。支持 locale 前缀（默认 `zh-CN` 可省，`en`→`en-US`、`zh`→`zh-CN`、`zh-Hant`→`zh-TW`），正文按请求语言→`zh-CN`→原文→已有译文回退；UI 使用 `i18next`（`zh-CN`、`zh-TW`、`en-US`，SSR 显式传参不改共享实例）。KV `BLOG_SETTINGS` 键 `blog:supported-locales` 控制启用语言（`zh-CN` 不可删；新语言先扩 DB enum 再启用）。
- **保存、翻译与公开快照**：`save_content` RPC 同事务写元数据、正文与标签并校验 `content.updated_at`；发布后自动补齐启用语言的缺失/空译文（不覆盖已有完整译文），编辑器也可基于选定来源语言手动覆盖目标译文（`save_translation` 校验来源与目标 `updated_at`）。AI 翻译经 `AI_SERVICE` 调用[统一 AI Worker](../ai/README.md)（`TRANSLATE_MODEL` 或平台默认，要求 JSON 输出并保留 Markdown/代码/公式/链接）。
- **公开读取**：SSR 与浏览器导航统一经同源 `/api/public` 读取私有 R2 快照（不直接暴露 Neon 源库给访客，详情见 [CACHE](CACHE.md)）；关闭 hover 预取，列表只传摘要。

## 图片

图片存储、上传与 AI 生成由[图床](../images/README.md)负责；博客 `/api/images` 与 `/images/:id` 经服务绑定转发，原 UUID、正文链接与封面外键保留。

## MCP

- **接口**：`/api/mcp` 提供无状态 Streamable HTTP MCP（JSON 响应）。匿名可调用 `list_content`（每页最多 50 条摘要）、`get_content`、`list_tags`（读取 R2 公开快照）；管理员携带 Bearer Token 经 `packages/auth/server` 验签并校验 `blog.all:all` 后，可调用 `create_content`、`update_content`、`delete_content`（均需最近 `updated_at`）及标签 CRUD（被引用标签不可删；DB GRANT/RLS 仍生效）。
- **Cloudflare MCP Portal**：`https://mcp.hasbai.xyz/mcp`（Managed OAuth + Access Allow/Everyone，登录走 `auth.hasbai.xyz`，手动 OAuth `on_behalf=true` 连至 `https://hasbai.xyz/api/mcp`）。固定公布全部 9 个工具（每次管理调用校验 `blog.all:all`）。OAuth 回调白名单已登记 ChatGPT（`https://chatgpt.com/connector/oauth/*`、`https://chatgpt.com/connector_platform_oauth_redirect`）与 Claude（`https://claude.ai/api/mcp/auth_callback`、`https://claude.com/api/mcp/auth_callback`）。既有 Eastmoney Portal 迁至 `eastmoney-mcp.hasbai.xyz`（proxied CNAME 指向 `gateway.agents.cloudflare.com`）。

## 编辑和阅读

- 使用 Tiptap 3 WYSIWYG（不支持合并单元格）；含扩展语法时自动切源码与统一预览以保真（契约见 [MARKDOWN](../MARKDOWN.md)）。手记无标题与标签；未保存离开确认，失败保留内容。
- YAML SSR 解析固定使用浏览器 ESM 入口，避免产物注入 `createRequire`；`pnpm build` 附带 `scripts/check-worker-startup.mjs` 用固定 workerd 启动真实产物并验证 `/api/version` 与 MCP 协议。

## 迁移与发布

迁移位于 `database/blog`（`0002`–`0004` 清理继承、`0005` 独立页面、`0006`–`0009` 历史政策/名称迁移不可当通用 seed 重放、`0010` 统一翻译表）。Worker 绑定 `IMAGE_SERVICE`、`AI_SERVICE`、`BLOG_SETTINGS`、`BLOG_PUBLIC` 与 `hasbai.xyz`/`blog.hasbai.xyz`；Workers Builds 在 `apps/blog` 执行 `pnpm build`。交付与隔离分支检查见 [TESTING](../TESTING.md)。

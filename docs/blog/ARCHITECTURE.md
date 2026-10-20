# 博客架构

开发边界、首页文案授权与任务路由见[博客入口](README.md)。本页源码路径相对 `apps/blog`；共享包和数据库路径相对仓库根。共享登录/授权见[AUTHORIZATION](../AUTHORIZATION.md)，共享组件与主题原则见[DESIGN](../DESIGN.md)。

## 结构与主题

SvelteKit 负责 SSR 页面，Hono 负责 `/api/**` 与 `/images/**` 接口。`hooks.server.ts` 分派请求并设置统一安全头。业务 repository 和主题留在应用内，共用 `packages/ui`、`packages/auth`、`packages/data`、`packages/markdown`。博客近白 neutral 底、深灰文字、少量玫瑰色强调、衬线正文、紧凑导航。桌面花瓣以轻量 SVG 显示首屏，水合后淡出并交给 Canvas；移动端和减少动效偏好停用。

站点名称及页面无障碍名称引用 `site.name`（北极小站），手记只是内容类型；编辑器标题保留站点后缀。共享 Markdown 扩展和源码编辑选择见[MARKDOWN](../MARKDOWN.md)。

## 数据与权限

`0010_translations.sql` 直接移除 PostgreSQL 表继承。`public.content` 保存语言无关的元数据：UUID、类型、原文语言、slug、序号、封面、发布状态和时间。文章、手记及独立页面共用这张表。`kind`、`status` 和 `source_locale` 使用 PostgreSQL enum。

`public.translation` 保存 title、excerpt、markdown 和更新时间。`(content_id, locale)` 是主键；locale 使用 enum。修改和手动翻译直接覆盖该语言行，不保存多版本。元数据和所有语言正文共享发布状态；匿名 RLS 只允许读取已发布且发布时间已到的内容。

迁移保留原有 UUID、slug、序号、发布时间、正文和标签关系。已有正文登记为 zh-CN。`public.tag.translations` 直接保存语言到名称的 JSONB 映射；保留 zh-CN 名称作为回退。`public.article_tag` 关联 content 与 tag。财务对象不受此迁移影响。

公开路径仍为 `/articles/:slug`、`/notes/:sequence` 和独立页面根路径。`/contents/:id` 和 legacy_path 永久重定向到规范链接。页面 slug 不得占用功能路径或语言前缀；独立页面不进入首页和时间线。

所有公开页面及编辑室支持 locale 前缀。默认 zh-CN 可以省略前缀；en 映射到 en-US，zh 映射到 zh-CN，zh-Hant 映射到 zh-TW。新增语言的短码按已启用语言列表匹配。内容按请求语言、zh-CN、原文语言、已有译文的顺序回退，并返回实际正文语言。

前端 UI 使用 i18next，默认提供简体中文、繁体中文及英文词典。SSR 按请求解析语言，翻译函数显式指定语言，不修改共享实例的当前语言。日期和站内导航沿用界面语言；正文标记实际语言。

Worker 的 BLOG_SETTINGS 绑定保存 KV 键 `blog:supported-locales`。默认列表是 zh-CN、zh-TW、en-US。编辑室可以启用或禁用已注册语言，zh-CN 必须保留。新增语言先扩展数据库 locale enum，再在编辑室启用。禁用语言保留已有译文。

`save_content` RPC 在同一事务内写元数据、当前语言正文及文章标签。保存使用 content.updated_at 检查冲突。编辑室通过 `/api/content` 保存；MCP 使用同一服务端保存服务。公开读取仍直连 Data API。

发布后服务端自动补齐启用列表中的缺失译文，已有完整译文保持原样。空正文视为缺失，公开读取回退到完整译文。翻译失败保留已保存原文，并返回待补语言。修改时可在编辑器选择目标语言和已保存的来源语言，手动翻译并直接覆盖目标正文。未保存的修改需先保存。

`save_translation` RPC 核对来源及目标译文的 updated_at。自动补译补齐缺失行和空正文；手动翻译拒绝覆盖调用期间被编辑的目标行。两种写入都会更新 content.updated_at，删除内容会级联删除译文。

AI 调用使用 custom Gateway 的 `dynamic/translate` 动态路由（`custom/translate`），其 provider 为 custom-codex。请求使用 compat/chat/completions，模型由网关配置决定。推理 Secret `AIG_TRANSLATE_RUN_TOKEN` 只在 Worker 中使用。服务端要求 JSON 输出，拒绝截断、无效和空正文响应；提示词要求保留 Markdown、代码、公式和链接。[Cloudflare 动态路由](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/usage/)

Neon 网关要求 JWT，包括匿名访问。访客直接调用 Neon Auth `/token/anonymous` 获取短期 `role=anonymous` JWT，再直接读取 Data API；不登录、不经博客 API 代理、不使用数据库密钥。SSR 同样调用这两个公开端点。公开页使用 SvelteKit 通用 `+page.ts` load，水合后的页间跳转直接从浏览器请求匿名令牌与 Data API，不再获取 `__data.json`；导航期间立即显示骨架，关闭 hover 预取。

首页和列表只读摘要列，不序列化整篇 Markdown；浏览器短时复用匿名令牌。Auth0 管理员登录继续用共享 SPA PKCE，缓存与续期见[共享授权规则](../AUTHORIZATION.md)。Neon managed auth 仅提供匿名令牌；不增加另一套用户登录入口。新增 managed `neon_auth` 属平台系统 schema，博客业务表仍全部在 public。

## 图片

图片存储、上传和 AI 生成由[图床](../images/README.md)统一负责。
博客的 `/api/images`、`/images/:id` 通过服务绑定转发。
原 UUID、正文图片地址和封面外键保留，用户内容不改写。

## MCP

`/api/mcp` 提供 Streamable HTTP MCP，匿名公开读取，管理员携带 Bearer Token 管理内容。Hono 路由使用标准 MCP SDK，响应为 JSON。每个请求新建 server 和 transport，完成后关闭；不使用会话或独立 SSE 流。

- `list_content`：按类型分页，可搜索标题、摘要和正文。列表只返回摘要与规范网址，每页最多 50 条。
- `get_content`：按类型和 UUID 读取 Markdown 正文与规范网址。
- `list_tags`：读取公开标签。

匿名请求使用 `publicRepository()` 的匿名 JWT，列表和详情限定发布状态与发布时间。管理员 Token 使用共享 `packages/auth/server` 验证签名、issuer、audience、有效期和用户身份，再检查 `blog.all:all`。无效 Token 返回 401；普通用户仍只读公开内容。

管理员可调用 `create_content`、`update_content`、`delete_content`，管理文章、手记和独立页面。写入复用统一 content/translation schema、repository 和原子 RPC。修改和删除要求最近读取的 `updated_at`；文章详情返回 `tag_ids`。

管理员还可新建、修改、删除标签；已被文章引用的标签不能直接删除。数据库继续执行 GRANT/RLS。

Cloudflare MCP Portal“北极小站”的入口为 `https://mcp.hasbai.xyz/mcp`。Managed OAuth 与 Access Allow/Everyone 允许任意用户登录。登录统一使用北极组织及 `auth.hasbai.xyz`，提供邮箱、Google、Microsoft Account、GitHub。

Portal 的 Managed OAuth 回调白名单包含 `https://chatgpt.com/connector/oauth/*` 与 `https://chatgpt.com/connector_platform_oauth_redirect`。仅允许本地回调会使 ChatGPT 连接返回 `Redirect URI not allowed by application configuration`。2026-10-13 补齐配置后，两种回调的 OAuth 请求均返回 302 并进入 Access 登录；ChatGPT 完整连接须重新发起验收。[官方回调规则](https://developers.openai.com/plugins/build/auth#redirect-url)

上游为 `https://hasbai.xyz/api/mcp`，采用手动 OAuth，`on_behalf=true`。Portal 为每个用户保存并转发共享 audience 的 Auth0 Token，不使用共享管理员 Token。普通用户经 Portal 读取公开内容，管理员经同一 Portal 增删改查。

MCP 固定公布九个工具，避免 Portal 缓存目录随登录用户权限缩减。每次管理调用检查 `blog.all:all`，普通用户和旧权限 Token 均拒绝写入。Portal 未登录请求返回 401，并提供 OAuth 发现地址；上游仍允许匿名读取。

2026-10-13 真实管理员经 Portal 的增删改查与版本冲突拒绝通过。无角色合成账号公开读取通过，草稿不可见，六个管理调用均拒绝。详细证据见[DELIVERY](history/DELIVERY.md#hono-mcp-portal-与权限统一2026-10-13)。

既有 Eastmoney Portal 迁到 `eastmoney-mcp.hasbai.xyz`，保留服务与访问策略。API 创建 Portal 后须设置 proxied CNAME，指向 `gateway.agents.cloudflare.com`。完成部署后再同步工具并核验实际调用，不能只核验资源创建。[官方配置说明](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/)

## 编辑和阅读

Tiptap 3 WYSIWYG，Markdown 官方扩展；支持标题、粗斜体、列表、引用、代码块、链接、表格、图片、撤销/重做和 Markdown 源码切换。安全渲染与扩展契约见[共享 MARKDOWN](../MARKDOWN.md)。Markdown 表格不支持合并单元格，编辑工具不提供这种操作。

文章可管理标签；手记使用同一 Markdown 编辑器，不填写标题或标签。封面可上传/移除，图片 name 作为默认 alt/title。离开未保存文档有确认；失败不清空内容。

YAML 的 SSR 解析固定使用依赖提供的浏览器 ESM 入口，避免 Node/CommonJS 构建注入 `createRequire(import.meta.url)`，导致 Worker 初始化失败。博客固定独立 workerd 开发依赖，保留生产兼容日期，通过 Miniflare 的运行时路径覆盖用于启动检查。生产 `build` 完成后用本地 workerd 启动实际 Worker。检查包括版本接口、MCP 初始化、工具发现、无效输入、通知与 HTTP 方法。候选流程和 CI 均执行；Vite/Node 预览不能替代该运行时检查。

## 迁移与发布

迁移在 `database/blog`；测试 SQL 的写入事务回滚。历史 `0002`–`0004` 完成继承和分类清理；当前 `0010` 直接替换为统一内容及翻译表。

`0005` 增加独立页面约束/权限；`0006`–`0009` 是特定内容版本的名称/政策迁移，不能当通用初始化脚本重放。正文冲突整体回滚，保留 UUID 与用户内容，详细历史见[DELIVERY](history/DELIVERY.md)。

Worker 使用 `wrangler.jsonc` 的 IMAGE_SERVICE、KV BLOG_SETTINGS 绑定和两个自定义域名。Workers Builds 从 `apps/blog` 执行 `pnpm build`，本地构建亦包含实际 workerd `/api/version` 启动验证；自动 Build 与线上 SSR 仍须单独核验。统一检查、隔离 Neon 迁移、Linux 基线与 PR 交付见[TESTING](../TESTING.md)。

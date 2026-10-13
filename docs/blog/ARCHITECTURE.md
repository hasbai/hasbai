# 博客架构

开发边界、首页文案授权与任务路由见[博客入口](README.md)。本页源码路径相对 `apps/blog`；共享包和数据库路径相对仓库根。共享登录/授权见[AUTHORIZATION](../AUTHORIZATION.md)，共享组件与主题原则见[DESIGN](../DESIGN.md)。

## 结构与主题

SvelteKit 负责 SSR 页面，Hono 负责 `/api/**` 与 `/images/**` 接口。`hooks.server.ts` 分派请求并设置统一安全头。业务 repository 和主题留在应用内，共用 `packages/ui`、`packages/auth`、`packages/data`、`packages/markdown`。博客近白 neutral 底、深灰文字、少量玫瑰色强调、衬线正文、紧凑导航。桌面花瓣以轻量 SVG 显示首屏，水合后淡出并交给 Canvas；移动端和减少动效偏好停用。

站点名称及页面无障碍名称引用 `site.name`（北极小站），手记只是内容类型；编辑器标题保留站点后缀。共享 Markdown 扩展和源码编辑选择见[MARKDOWN](../MARKDOWN.md)。

## 数据与权限

`0002_content_inheritance.sql` 将 `public.content` 作为 PostgreSQL 继承父表，`public.article` 与 `public.note` 为子表。父表保存 UUID、类型、Markdown、摘要、封面、发布状态和时间；文章另有标题、全站唯一 slug 与独立数字序列，手记没有标题或标签，使用自己的数字序列。`public.article_tag` 直接关联文章与 `public.tag`。

旧文章、图片及标签 UUID 不变，旧分类 URL 存入文章 `legacy_path` 供永久重定向。跨分类重名 slug 追加文章 UUID 前缀消歧。`0002` 先保留旧分类列和 `tag_ids` 以兼容旧 Worker，部署新 Worker 并核验后由 `0004_remove_category.sql` 移除 `public.category`、`article.category_id` 与 `article.tag_ids`。父表查询用于 `/contents/:id`，写入始终指向具体子表；PostgreSQL 继承不自动将父表写入路由到子表，也不跨子表继承主键唯一性。

公开路径为 `/articles/:title`（参数取文章 slug）、`/notes/:sequence` 与 `/contents/:id`（按 `kind` 重定向到规范路径）。首页混排最近的文章和手记，时间线按发布时间聚合。独立页面 `public.page` 继承 `content`。类型为 `page`，有标题与唯一根路径 slug（例如 `/about`、`/privacy`、`/terms`），没有文章序号或标签。

后台“独立页面”可创建、编辑、发布、撤回和删除，沿用 `updated_at` 冲突检测。根路径只接受小写字母、数字、连字符，禁止占用 articles、notes、timeline、tags、contents、studio、auth、api、images、assets。页面不进入首页、文章、手记或时间线；主导航固定只展示“关于”，页脚只有政策入口和版权。`/contents/:id` 同样支持 page 重定向。正文唯一存储为 Markdown，服务端和客户端使用同一安全 Markdown 渲染器。

文章保存使用 `save_article` Data API RPC，在一个数据库事务内写文章与标签关系，并用 id/updated_at 判断冲突；手记、独立页面和删除仍使用标准 PostgREST 写入。文章和手记创建时客户端生成 UUID。

UI 失败保留输入。发布要求正文和发布时间；匿名 RLS 仅放行已发布且发布时间已到的内容。`content`、`article`、`note`、`page` 与 `article_tag` 分别设置 RLS 与 GRANT；superadmin 写具体子表和关联表，anonymous 无写权限、无 financial schema 访问权。

Neon 网关要求 JWT，包括匿名访问。访客直接调用 Neon Auth `/token/anonymous` 获取短期 `role=anonymous` JWT，再直接读取 Data API；不登录、不经博客 API 代理、不使用数据库密钥。SSR 同样调用这两个公开端点。公开页使用 SvelteKit 通用 `+page.ts` load，水合后的页间跳转直接从浏览器请求匿名令牌与 Data API，不再获取 `__data.json`；导航期间立即显示骨架，关闭 hover 预取。

首页和列表只读摘要列，不序列化整篇 Markdown；浏览器短时复用匿名令牌。Auth0 管理员登录继续用同一 SPA PKCE、内存 token。Neon managed auth 仅提供匿名令牌；不增加另一套用户登录入口。新增 managed `neon_auth` 属平台系统 schema，博客业务表仍全部在 public。

## 图片

R2 bucket `image`，key 精确等于 image.id UUID。metadata 包括 name、sha256 唯一约束、content_type、size、width/height 可选、ready、created_at。上传限制 10 MiB，按字节识别 PNG/JPEG/GIF/WebP，拒绝 SVG/HTML。

先由 PostgREST 对 Auth0 token 执行元数据写入授权，再使用 Worker R2 binding 上传；sha256 唯一键处理并发去重，未完成的上传可重试同一 key，不产生重复图片。只有 ready 元数据对匿名可见。`/images/:id` 流式返回 R2 内容，nosniff、固定媒体类型与 immutable 缓存。图片为公开博客素材，不提供私有附件语义。

## MCP

`/api/mcp` 提供 Streamable HTTP MCP，匿名公开读取，管理员携带 Bearer Token 管理内容。Hono 路由使用标准 MCP SDK，响应为 JSON。每个请求新建 server 和 transport，完成后关闭；不使用会话或独立 SSE 流。

- `list_content`：按类型分页，可搜索标题、摘要和正文。列表只返回摘要与规范网址，每页最多 50 条。
- `get_content`：按类型和 UUID 读取 Markdown 正文与规范网址。
- `list_tags`：读取公开标签。

匿名请求使用 `publicRepository()` 的匿名 JWT，列表和详情限定发布状态与发布时间。管理员 Token 使用共享 `packages/auth/server` 验证签名、issuer、audience、有效期和用户身份，再检查 `blog.all:all`。无效 Token 返回 401；普通用户仍只读公开内容。

管理员可调用 `create_content`、`update_content`、`delete_content`，管理文章、手记和独立页面。写入复用现有 schema、repository 和文章原子 RPC。修改和删除要求最近读取的 `updated_at`；文章详情返回 `tag_ids`。

管理员还可新建、修改、删除标签；已被文章引用的标签不能直接删除。数据库继续执行 GRANT/RLS。

Cloudflare MCP Portal“北极小站”的入口为 `https://mcp.hasbai.xyz/mcp`。Managed OAuth 与 Access Allow/Everyone 允许任意用户登录。登录统一使用北极组织及 `auth.hasbai.xyz`，提供邮箱、Google、Microsoft Account、GitHub。

上游为 `https://hasbai.xyz/api/mcp`，采用手动 OAuth，`on_behalf=true`。Portal 为每个用户保存并转发共享 audience 的 Auth0 Token，不使用共享管理员 Token。普通用户经 Portal 读取公开内容，管理员经同一 Portal 增删改查。

MCP 固定公布九个工具，避免 Portal 缓存目录随登录用户权限缩减。每次管理调用检查 `blog.all:all`，普通用户和旧权限 Token 均拒绝写入。Portal 未登录请求返回 401，并提供 OAuth 发现地址；上游仍允许匿名读取。Portal 真实用户读取与增删改查尚待验收，工具同步不算验收通过。

既有 Eastmoney Portal 迁到 `eastmoney-mcp.hasbai.xyz`，保留服务与访问策略。API 创建 Portal 后须设置 proxied CNAME，指向 `gateway.agents.cloudflare.com`。完成部署后再同步工具并核验实际调用，不能只核验资源创建。[官方配置说明](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/)

## 编辑和阅读

Tiptap 3 WYSIWYG，Markdown 官方扩展；支持标题、粗斜体、列表、引用、代码块、链接、表格、图片、撤销/重做和 Markdown 源码切换。安全渲染与扩展契约见[共享 MARKDOWN](../MARKDOWN.md)。Markdown 表格不支持合并单元格，编辑工具不提供这种操作。

文章可管理标签；手记使用同一 Markdown 编辑器，不填写标题或标签。封面可上传/移除，图片 name 作为默认 alt/title。离开未保存文档有确认；失败不清空内容。

YAML 的 SSR 解析固定使用依赖提供的浏览器 ESM 入口，避免 Node/CommonJS 构建注入 `createRequire(import.meta.url)`，导致 Worker 初始化失败。博客固定独立 workerd 开发依赖，保留生产兼容日期，通过 Miniflare 的运行时路径覆盖用于启动检查。生产 `build` 完成后用本地 workerd 启动实际 Worker。检查包括版本接口、MCP 初始化、工具发现、无效输入、通知与 HTTP 方法。候选流程和 CI 均执行；Vite/Node 预览不能替代该运行时检查。

## 迁移与发布

迁移在 `database/blog`；测试 SQL 的写入事务回滚。`0002`/`0003` 先保留旧字段兼容旧 Worker，新 Worker 自动部署并核验后 `0004` 才删除分类和旧标签数组列。`0005` 增加独立页面约束/权限；`0006`–`0009` 是特定内容版本的名称/政策迁移，不能当通用初始化脚本重放。正文冲突整体回滚，保留 UUID 与用户内容，详细历史见[DELIVERY](history/DELIVERY.md)。

Worker 使用 `wrangler.jsonc` 的 R2 `image` 绑定和两个自定义域名。Workers Builds 从 `apps/blog` 执行 `pnpm build`，本地构建亦包含实际 workerd `/api/version` 启动验证；自动 Build 与线上 SSR 仍须单独核验。统一检查、隔离 Neon 迁移、Linux 基线与 PR 交付见[TESTING](../TESTING.md)。

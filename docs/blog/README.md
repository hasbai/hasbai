# Blog · 北极小站开发入口

`apps/blog`：SvelteKit SSR + Hono 接口，Worker `blog`（`hasbai.xyz` / `blog.hasbai.xyz`，canonical `https://hasbai.xyz`）。公开阅读，管理员在线编辑文章、手记与独立页面；财务专属限制不适用。

## 内容修改边界

首页保留用户原有主体文案。当前仅授权在页脚“隐私政策、服务条款”链接下左对齐以小字显示“本站公开阅读，编辑发布需登录后使用。”，不得扩展为应用介绍、权限说明或合规声明。

政策与正文修改遵循 [AGENTS](../../AGENTS.md#全局约束)；数据库中用户编辑版本必须保留，不得自动改稿或以历史政策迁移覆盖人工编辑。

## 范围与任务路由

- 业务表全在 `public`，当前内容/译文/标签/页面模型以[架构](ARCHITECTURE.md#数据与权限)及 `database/blog` 为准（不把早先“四表”当永久限制）。
- 不迁移/覆盖既有 Hugo 博客；图片交由[图床](../images/README.md)统一管理，旧图片地址保留。
- 用户登录只用共享 Auth0（规则见 [AUTHORIZATION](../AUTHORIZATION.md)），Neon Auth 仅为服务端重建公开快照提供短期匿名 JWT。

| 任务 | 入口 |
| --- | --- |
| 请求分析、R2 公开缓存、免费额度与失效 | [CACHE](CACHE.md) |
| SSR、多语言、路由、CRUD、AI 翻译、MCP 与 Worker | [ARCHITECTURE](ARCHITECTURE.md) |
| 安全渲染、数学、引用、图表与源码保真 | [共享 MARKDOWN](../MARKDOWN.md)；`packages/markdown` |
| 当前能力与未验收项 | [PROGRESS](PROGRESS.md) |
| 历史迁移、政策与 MCP 交付证据 | [history/DELIVERY](history/DELIVERY.md) |
| 本地检查、Linux 截图与交付 | [共享 TESTING](../TESTING.md) |

源码路径相对 `apps/blog`；数据库迁移与共享包相对仓库根。`pnpm dev:blog` 启动 5174；`build` 含真实 workerd 启动检查，不能仅用 Vite/Node 预览验收 Worker。

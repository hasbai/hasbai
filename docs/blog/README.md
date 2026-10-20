# Blog · 北极小站开发入口

`apps/blog` 使用 SvelteKit SSR 页面和 Hono 接口，Worker 为 `blog`。`hasbai.xyz` 与 `blog.hasbai.xyz` 共用 canonical `https://hasbai.xyz`。公开阅读，管理员在线编辑文章、手记及独立页面。财务专属限制不适用于博客。

## 内容修改边界

首页保留用户原有主体文案。当前只授权在页脚“隐私政策、服务条款”链接下面左对齐，以小字显示“本站公开阅读，编辑发布需登录后使用。”，不得扩展成应用介绍、权限说明或合规声明。

政策和正文修改按根 [AGENTS](../../AGENTS.md#全局约束)的用户内容授权规则执行。数据库中的用户编辑版本必须保留，不因审核退回或文档维护自动改稿；历史政策迁移有版本保护，不能当新库 seed 或覆盖后续人工编辑。

## 范围与任务路由

- 业务表全部在 `public`；当前统一内容、语言翻译、标签、页面与图片对象以[架构](ARCHITECTURE.md#数据与权限)及 `database/blog` 为准，不把最初“四表”描述当永久限制。
- 现有 Hugo 博客和文章不迁移、不覆盖。图片交由[图床](../images/README.md)统一管理，旧图片地址保留。
- 用户登录只使用共享 Auth0，Neon Auth 仅为访客提供短期匿名 JWT；[AUTHORIZATION](../AUTHORIZATION.md)统一维护权限与 audience。

| 任务 | 入口 |
| --- | --- |
| SSR、多语言、路由、CRUD、AI 翻译、图片、Worker | [ARCHITECTURE](ARCHITECTURE.md) |
| 安全渲染、数学、引用、图表与源码保真 | [共享 MARKDOWN](../MARKDOWN.md)；`packages/markdown` |
| 当前能力与未验收项 | [PROGRESS](PROGRESS.md) |
| 政策、名称、内容迁移和登录变更的历史证据 | [history/DELIVERY](history/DELIVERY.md) |
| 本地检查、Linux 截图和交付 | [共享 TESTING](../TESTING.md) |

源码路径以 `apps/blog` 为工作目录；数据库迁移和共享包路径相对仓库根。根 `pnpm dev:blog` 启动 5174；构建包含真实 workerd 启动检查，不能仅用 Node/Vite 预览验收 Worker。

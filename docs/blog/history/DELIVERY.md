# 博客交付历史

> 以下是当时的记录，不代表当前状态。当前入口见[博客架构](../ARCHITECTURE.md)。

## 2026-09-26 博客视觉参考修正（已上线）

- 直接对照 `innei.in` 与线上博客的桌面与移动首页、文章列表、阅读页、手记、时间线和关于页。确认上一版暖黄/棕色主题、放大的衬线标题与单一光晕偏离参考。
- 在既有 SvelteKit、Luma UI、Tailwind 和 Data API 架构内，改为 neutral 主题和紧凑层级；桌面增加与参考站同类的缓落花瓣 Canvas 背景，详情页加轻微页头波纹，移动导航移至底部。背景随主题变色，并在移动端或减少动效偏好下停用。
- PR #15 的 28 张候选截图经审阅导入，普通 `Blog` 与 `Check` 工作流的代码和视觉检查均通过。合并提交 `6fb530f` 已由 Cloudflare 自动部署到 `hasbai.xyz`；线上桌面首页确认近白底色和水合后的花瓣 Canvas，390px 移动视口无横向溢出。本次没有数据库迁移或业务数据改动。

## 2026-09-23 博客内容模型与界面

- 博客首页、文章、手记、时间线、关于及编辑室已按参考站点改版；新增暖纸色、响应式排版、导航状态、入场与滚动动效，并保留减少动效偏好。客户端导航直接读取 Data API 并显示骨架，不再请求 `__data.json` 或悬浮预取。
- `content` 父表继承出 `article`、`note`；UUID 为内容主键，两类各有数字序列。文章用 `article_tag` 关联标签，手记无标题和标签。`0002`、`0003`、`0004` 先经生产隔离分支验证，再分两阶段执行到生产；新 Worker 上线后才删除分类表及旧列。原文章 `b8d0238b-5156-4a06-922d-139c3310fe76` 和图片 `3e7f2241-b3f5-4e62-b98d-819c15f94240` 的 ID 保持不变。
- PR #13 的博客/财务必要检查和博客视觉回归通过；Cloudflare 自动构建失败源于旧构建令牌，更新触发器令牌后重试同一合并提交成功，Blog Worker 版本 `69e78703-925d-4253-8711-d185c19cdf07` 已承载全部流量。两域名公开页面、统一内容入口 308、生产 Data API 的继承读取和匿名写入拒绝已核验；真实 Auth0 管理员写入、R2 上传及 iOS 真机未在本轮验收。
- 线上旧链接 `/notes/hello-world` 曾被手记序号路由截获而返回 404；本次补丁将序号路由限定为正整数，并在 CI 中验证旧链接 308 到文章规范地址。


## Google OAuth 公开说明（2026-10-04）

用户已要求撤回未经确认的首页长说明，恢复原主体文案；首页仅显示小字“本站公开阅读，编辑发布需登录后使用。”，位于“隐私政策、服务条款”链接下面左对齐。修改用户内容须先展示具体文案、位置和范围并取得同意，审核退回信息本身不构成改稿授权。此规则已写入 `AGENTS.md`。

用户已编辑并授权采用政策审阅稿。`0009_user_reviewed_policy.sql` 仅更新隐私政策正文：采用用户的登录信息和保存期限措辞，移除完整“AI 文字对话与日志”章节。其他保留段逐字采用用户稿；服务条款与现状一致，不重复改写。

先在隔离生产分支 `blog-user-reviewed-policy-20261004` / `br-withered-wildflower-b3xo6oce` 验证重复执行、并发冲突拒绝和其他内容/元数据 fingerprint，再更新生产。既有 62 项数据库检查与博客页面权限检查通过，测试写入全部回滚；生产匿名 API 和 SSR 返回 200，隐私正文 hash 为 `dd935b834c3fedc6d37ab6a65282e712`。页面 ID、标题、摘要、发布状态及发布时间保留，服务条款正文 hash 不变。

`database/blog/0007_oauth_disclosures.sql` 以生产人工编辑版本为基线，补充 Google 身份资料的访问、使用、Auth0 存储及 Cloudflare/Neon 处理。另补充 AI 模型传输、Gateway 完整请求/回复、账号名称记录、保留和删除方式；删除“不保存个人敏感信息”的错误概括。迁移只适用于本次生产两页 UUID 和已审阅正文，不能用于全新数据库的顺序初始化。行锁及正文 MD5 拒绝并发编辑，任一冲突整体回滚；重复执行不改变时间戳，原页面 ID、标题、摘要、发布状态和发布时间保留。

隔离生产分支 `blog-oauth-disclosures-20261004` / `br-wild-scene-b3kuusvz` 通过迁移、重复执行和并发冲突拒绝，文章、手记、图片、标签及页面其他元数据 fingerprint 一致。既有数据库脚本 62 项检查与 `database/blog/test_pages.sql` 的公开读取、草稿隔离、CRUD、匿名写入拒绝均通过，测试写入全部回滚。已应用生产，真实匿名 JWT API 与公开政策 SSR 均返回 200，两页正文 MD5 与隔离验证结果一致。

`0008_policy_site_link.sql` 将隐私页站点裸 URL 改为显式 Markdown 链接，避免自动链接吞入后续中文；仅精确替换命中的短语，保留其他正文和元数据。已先在上述隔离分支验证，再应用生产；未登录浏览器确认链接文字与目标均正确，夹具增加实际链接断言。

独立页面 2 项流程与 10 张 Linux 候选重新通过并审阅导入。`0007` 的幂等验证针对其完成时的正文；后续人工编辑或 `0008` 会使其版本保护拒绝重跑，正常顺序迁移不重放旧政策快照。

Auth0 Google 连接实际配置为 `email`、`profile`；不修改现有登录连接。已核对 Google 项目 `hasbai` 的品牌名称“北极小站”、首页 `https://hasbai.xyz`、隐私 `https://hasbai.xyz/privacy`、条款 `https://hasbai.xyz/terms` 及授权域名 `hasbai.xyz`；控制台数据访问列表为空，尚未修改声明范围或重新提交审核，也未取得 Google 通过结论。登记授权域名不等同于再次验证 Search Console 所有权。

固定 Linux 镜像运行首页与独立页面场景，iPhone/WebKit、桌面/Chromium 共 4 项流程通过，34 张候选已审阅；导入首页、空首页及两份政策的有意变化，新增首页深色截图，其他页面保留原基线。博客 10 项单元测试通过；完整验收仍以 PR 最新提交 CI 为准，设备模拟不是 iOS 真机验收。

站点名统一为“北极小站”，所有页面标题、首页文案和无障碍名称引用 `site.name`；“手记”仅作为内容类型名称。编辑室及文章、手记、独立页面编辑器标题均保留站点后缀。

`database/blog/0006_site_name.sql` 仅纠正关于页旧标题及政策中精确命中的旧名称短语，并更新发生变化行的 `updated_at`。已在生产隔离分支 `blog-site-name-20261004` / `br-curly-lab-b3tquqyq` 验证并应用生产；页面 ID、其他元数据和既有文章、手记、图片 fingerprint 不变，重复执行无变化。生产仅关于页命中更新，政策正文保留用户编辑版本。生产匿名 JWT API 的三页读取均返回 200，标题和正文已无旧站点名。


## 独立页面迁移（2026-10-04）

`database/blog/0005_pages.sql` 添加 page 的显式主键、唯一路径、正文与发布约束、RLS 和 GRANT。旧 About 文字落库。隐私政策与服务条款使用 jsclndnz@gmail.com 作为联系邮箱。描述北极小站统一登录的实际身份范围及相关应用的数据处理；不更改 Auth0 登录连接或 Google OAuth 配置。已在隔离生产分支 `blog-pages-20261004` / `br-cold-cloud-b3cldjol` 验证，再应用生产并通过 NOTIFY 刷新 Data API schema cache。

真实匿名 JWT 读取三份已发布页面返回 200；迁移前后原文章记录 fingerprint 一致。政策页不经登录也可 SSR 读取。验证 SQL 位于 `database/blog/test_pages.sql`，全部测试记录和变更在事务结束时回滚。

本地固定 Linux 候选 `2026-10-03T17-06-10.926Z` 已审阅并导入 38 张手机/桌面基线，7 项流程通过、1 项按设备跳过。覆盖 page SSR、canonical、UUID 跳转、顶部导航、流隔离、自定义路径发布/改名/删除和重复/保留路径。另检查失败保留输入及拒绝放弃未保存编辑。隐私页同时验证浅深色；设备为 WebKit/Chromium 模拟，不是 iOS 真机。普通 PR 验收与自动部署结论随发布另行核验。


## 北极小站统一登录方式（2026-10-04）

博客、财务、Tavern 和 Zboard 共用 `packages/auth` 的 Auth0 Universal Login。共享工厂不再强制 `connection=eastmoney-email`，由同一北极小站组织显示邮箱、Google、Microsoft Account 和 GitHub；Zboard 继续使用独立 API audience。通用能力后续继续在共享 packages 实现，不增加各应用专属登录选择或重复认证配置。

Google、Microsoft 和 GitHub 均已启用到北极小站应用及组织，Microsoft 组织连接已补齐。用户确认允许新 OAuth 账号登录、各应用权限另行分配：三个社交连接统一启用 `assign_membership_on_login=true`，邮箱连接准入与 signup 设置保留；不关联已有身份、不复制角色、不修改 Action。无角色账号仍签发 `role=authenticated`、`_roles=[]`，Tavern 允许经过 JWT 验证的普通用户管理本人数据，Zboard 首次账号默认禁用。

提供商回调统一使用 `https://auth.hasbai.xyz/login/callback`。共享 SDK 的 domain、Tavern/Zboard Worker 的 issuer/JWKS 和两应用 CSP 均使用 `auth.hasbai.xyz`；各应用自身 `/auth/callback`、组织与 API audience 保留。原租户 `hasbai.eu.auth0.com` 仍是 Auth0 管理入口，不用于应用登录。旧域会话在切换后需重新登录。

上一轮社交登录统一的共享 SDK 配置及 Zboard audience 的 9 项相关单测通过；四应用36张候选已审阅，35张像素一致、博客桌面编辑器20个像素差异，既有视觉基线保持。本轮自定义域名验证见下一节。视觉夹具不执行真实 OAuth，完整账号登录、PR CI 和线上部署须分别核验。


## 自定义登录域名（2026-10-04）

统一使用 `auth.hasbai.xyz`。Auth0 自定义域状态为 ready，discovery 的 authorize/token/JWKS 均指向该域。浏览器使用真实共享 SDK 打开登录后，Google、Microsoft Account、GitHub 均进入提供商正常登录表单，实际 redirect_uri 为 `https://auth.hasbai.xyz/login/callback`。邮箱真实 PKCE 登录和新域 JWT 的财务读取、博客草稿读取/零行 PATCH 权限验证通过；缺少 token、错误签名、错误 audience 均拒绝。第三方账号完整登录未代用户操作。

本地固定 Linux 镜像生成并审阅四应用36张代表截图；34张与基线完全一致，博客桌面编辑器20个像素、Zboard桌面模板8个像素差异，无有意视觉变化，保留既有基线。Financial 登录/PWA 12项相关单测通过。完整检查和线上自动部署在 PR 发布阶段独立核验。


## 登录字段兼容（2026-10-04）

统一 Auth0 Action 使用 `auth0/login-claims.js`：顶层 `username`、`email` 为身份字段，`_roles` 为角色数组，`role` 为 Neon 数据库角色字符串。共享财务/博客 audience 的角色数组包含 superadmin 时签发 `role=superadmin`，其他 audience 或账号为 authenticated；Zboard 保留独立 audience，通过 `_roles` 判断管理员。酒馆验证用户 JWT，管理员权限读取 `permissions`，保留统一 audience。两份应用 setup 脚本复用同一 Action，并移除旧应用角色 Action 的重复绑定，避免重新签发旧字段。

`role` 改成数组后，Neon 仍按 anonymous 执行，导致 `permission denied for table page`；生产 page CRUD GRANT 和编辑 RLS 本身正常。本次保留 Data API `.role` 和全部生产表权限，不添加授权 SQL 包装或扩大匿名权限。

新令牌已在隔离生产副本 `auth-role-array-20261004` / `br-blue-feather-b38q5syq` 实测页面草稿创建、读取、更新、删除及文章 RPC 创建/更新；匿名公开读取、草稿隔离和写入拒绝通过。生产真实 JWT 已验证 page UPDATE 权限及财务读权限；完整页面与文章写入在隔离分支实测。

最新线上统一 Action 的 blocked、邮箱验证及东方财富组织资料字段保留；将错误的字符串 contains 调用修正为 includes，避免登录返回 access_denied；数据库 superadmin 角色限定到共享财务/博客 audience。新 Zboard JWT 仍在 `_roles` 中保留 superadmin，但其数据库 role 为 authenticated，财务读取返回 403、博客写入返回 400（缺少对应 audience）。已经签发的旧令牌不会因 Action 更新被撤销，需等待过期或重新登录。旧浏览器会话需重新登录取得新签名字段，未保存编辑应先保留。

本地固定 Linux 流程完成博客全站和四应用代表页面截图审阅，无有意视觉修改；原视觉基线保留。完整单测、类型和视觉比较由 PR CI 执行；线上应用版本与真实 Worker JWT 验收在发布后独立核验。



## Markdown 扩展（2026-10-09）

2026-10-09 固定 Linux 候选 `2026-10-09T02-53-45.317Z`：11 项流程通过、1 项按设备跳过，50 张截图已比对；审阅并导入新增扩展展示/预览及编辑工具栏的 12 张基线，其他原基线保留。覆盖 WebKit/Chromium 浅深色、真实三类图表渲染、KaTeX SSR、脚注双向跳转、局部图表失败、预览与保存重开保真。Mermaid 使用禁用过渡的临时容器测量，防止全局减少动效样式导致 Chromium 包围盒裁切。完整单测、类型和严格视觉比較由最终 PR CI 执行，设备为模拟。


## Hono MCP Portal 与权限统一（2026-10-13）

博客接口使用 Hono；MCP 位于 `/api/mcp`。北极小站 Portal 入口为 `https://mcp.hasbai.xyz/mcp`。Eastmoney Portal 迁至 `eastmoney-mcp.hasbai.xyz`，保留原服务及访问策略。

Portal 和上游 MCP Access 应用使用 Allow/Everyone。独立 Auth0 Regular Web 应用启用 OIDC 与 RS256；上游采用逐用户 OAuth，不共享管理员 Token。登录统一提供四种连接；邮箱允许组织内注册及自动加入，保留邮箱验证。此次真实完整登录只验收邮箱账号。

Hasbai 五个应用权限统一为 `scope.resource:action`，具体值见[AUTHORIZATION](../../AUTHORIZATION.md#已有-auth0-api-与权限)。Auth0 已移除五个旧权限定义；全部八个角色回读均无旧授权。超级管理员保留五个规范权限。Eastmoney 现有权限保留，代码不接受旧权限别名。权限改名不撤销已签发的 JWT，也不改变 Data API 的数据库角色规则。

真实管理员使用 MCP SDK 经 Portal 完成文章、手记、独立页面的新建、读取、修改、删除。三类内容的旧版本更新均拒绝，标签增删改查通过。独立无角色合成账号经正常 Universal Login 及上游 OAuth 验收：公开列表与正文可读，三个草稿均不可见。六个管理调用使用有效参数，均拒绝并提示 `blog.all:all`；管理员回读确认内容及标签未变。

三个合成草稿与标签均经管理员 Portal 删除并回读确认；临时用户已删除并确认 404。此记录不证明新用户注册、邮箱验证及三个社交账号完整登录已实测。

[PR #75](https://github.com/hasbai/hasbai/pull/75) 部署 Hono MCP。[PR #77](https://github.com/hasbai/hasbai/pull/77) 部署统一权限及逐次 MCP 管理检查。四应用本地非浏览器检查及 12 个 PR 必需状态通过。合并 SHA 为 `88d0be732e3e1a7ea79c065ebfd6362b0162ccc4`；四个自动 Build 均成功，Worker 版本及 100% 流量回读如下。

| Worker | 部署版本 |
| --- | --- |
| Financial | `7a235e6f-90d2-48bb-8b54-92bade86767f` |
| Blog | `da0ce7d9-1840-4e1c-9959-1cf6422eefa7` |
| Tavern | `35fec48d-3bed-4a75-8ddd-b481426a5d2c` |
| Zboard | `fcf051be-a9bf-4bb6-a072-6c9240fbbd48` |

独立 Vaultwarden 仓库 `cloudflare` 分支提交 `cc75828d43cd5a2f2aae9f23a6fdb8047bf26ec9`。自动 Build 成功，版本为 `13584f8b-885d-4a94-9be4-fddccd74f512`；线上 `AUTH0_PERMISSION` 为 `vaultwarden.all:all`。

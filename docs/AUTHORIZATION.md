# 北极小站授权规则

适用于四个应用；仓库实现入口是 `packages/auth/src/config.ts`、`auth0/login-claims.js` 和各 Worker 的 auth 模块。Auth0 后台登记基于 2026-10-04 核验，实际操作须回读；本次文档维护不重新配置远端。

登录统一使用 `packages/auth`、`auth.hasbai.xyz` 与已有北极小站组织。Auth0 负责权限签发；接口验证用户 JWT 后判断对应 `permissions`。普通用户无需 Auth0 `authenticated` 角色。

## 统一登录与身份字段

- 浏览器共用 `packages/auth` 官方 SPA SDK 工厂，Authorization Code + PKCE，token 只在内存，请求使用 `getTokenSilently`。生产代码不处理密码，退出清除相关查询缓存。
- 公开配置的登录域名为 `auth.hasbai.xyz`，管理租户为 `hasbai.eu.auth0.com`，北极小站组织、client ID 和默认 audience 从共享配置引用，应用不重复维护。
- 统一提供邮箱、Google、Microsoft Account、GitHub，不强制 `connection=eastmoney-email`。三个社交连接已登记允许登录时加入组织，业务权限另行分配；邮箱准入保持。不关联原身份、不复制角色。
- 提供商 callback 为 `https://auth.hasbai.xyz/login/callback`；各应用 callback 仍是自身 `/auth/callback`，localhost origin 以应用开发端口登记。Worker issuer/JWKS 使用自定义域名；Neon 既有同租户 provider/JWKS 取钥地址保留。修改前核查消费者。
- Action 签发顶层 `username`、`email`、`_roles`（兼容角色数组）、`role`（数据库标量）。共享 audience 下具有 superadmin 角色时 `role=superadmin`，其他账号或 audience 为 authenticated。公共用户名签发不限定 Tavern；保留 blocked、邮箱验证和东方财富组织字段。
- 应用管理员授权使用原生 `permissions`，不以 `_roles` 回退。数据库的标量 role、GRANT/RLS 与前端 permission 是不同执行点，不能互相替代。旧 token 需重新登录或到期更新。

## 应用与接口边界

| 应用 | 匿名 | 普通登录用户 | Super Admin | 权限与执行点 |
| --- | --- | --- | --- | --- |
| 博客 | 读取已发布且发布时间已到的文章、手记、独立页面、图片 | 同公开读取范围，无编辑权限 | 编辑、发布、删除及上传图片 | `manage:blog`：编辑室、编辑请求与 MCP 管理工具；MCP 使用共享 JWT 验证，Data API 的 GRANT/RLS 继续执行 |
| 北极账本 | 无财务数据访问 | 无财务访问 | 全部财务功能 | `access:financial`：应用入口及数据请求；Data API 继续使用标量 `role=superadmin` 和原 schema/对象 GRANT |
| 酒馆 | 无私有数据访问或对话 | 搜卡、安装/导入、编辑/删除本人卡片和世界书、本人会话及对话、本人设置、服务端白名单模型选择 | 同本人功能；全站敏感操作仅管理员 | 现有 `/api/characters`、`discover`、`install`、`worldbooks`、`sessions`、`settings`、`models` 验证用户 JWT，以 `sub` 隔离本人数据；`manage:tavern` 为全站管理边界 |
| Zboard | 无账户访问；随机订阅凭据与 Node token 为独立协议 | `/api/me`、`/api/me/rotate`；首次登录仍默认禁用，启用、节点、配额、有效期控制服务资格 | `/api/admin/**` 用户、节点、模板、配额及报告管理 | `manage:zboard`：Worker 验证 JWT 后判断管理员；订阅资格及 Node API 机制保留 |

用户确认酒馆“敏感操作”为全站模型/网关配置、公共目录同步、查看或处理他人数据。应用提示词属于全站配置：登录用户可 GET /api/prompts；PUT /api/prompts 需要 manage:tavern。模型/网关配置和目录同步由服务端配置及运维脚本控制。

现有业务接口均限定本人资源；Super Admin 也不能通过本人接口绕过 owner 读取他人数据。`manage:tavern` 不代表当前已提供全站管理功能；新增全站接口时必须在执行点强制检查该权限。普通用户模型选择仅接受服务端白名单逻辑 ID，不开放任意模型、URL 或密钥。

## 已有 Auth0 API 与权限

| API | audience | 使用情况 | RBAC | Access Token 权限 |
| --- | --- | --- | --- | --- |
| financial | `https://financial.hasbai.xyz/api` | 财务、博客、酒馆共用 | 已开启 | `access:financial`、`manage:blog`、`manage:tavern` |
| Zboard API | `https://zboard.hasbai.xyz/api` | 独立 Zboard | 已开启 | `manage:zboard` |
| Tavern API | `https://tavern.hasbai.xyz/api` | 历史保留，当前酒馆不请求该 audience | 已开启 | 当前未定义权限，声明为空 |
| eastmoney gateway | `https://eastmoney.hasbai.xyz/` | 其他业务，保留现有权限和分配 | 已开启 | 原有 61 项权限，随原角色分配签发 |
| Auth0 Management API | 租户 `/api/v2/` | Auth0 系统管理 | 系统 API 保留 | 不向业务用户扩大 Management API 授权 |

2026-10-04 后台登记的四个自定义 API 均使用 `enforce_policies=true` 与 `access_token_authz`。Auth0 原生生成当前 audience 下全部已授予的 `permissions`，不由 Action 手工拼接，不要求 SPA 逐项请求 scope。上述四项新增权限仅授予已有 tenant `superadmin` 角色，原角色、组织成员和东方财富 61 项定义不修改。旧 Access Token 不会被重写；重新登录或令牌到期后取得新声明，应用不以 `_roles` 回退管理员授权。

租户现有 `authenticated` 为东方财富组织角色，包含原内测权限，不能作为北极小站新用户默认角色。顶层 `role=authenticated` 是 Neon 数据库角色字符串，不等于授予 Auth0 同名角色。`_roles` 继续保留兼容；财务/博客 Data API 的数据库 `role`、GRANT/RLS 不能由前端 `permissions` 替代。无数据库迁移、无新增表或字段。

服务端仍验证签名、issuer、audience、有效期和用户 sub，并拒绝机器令牌。仅携带一个字符串 Token 不算登录。前端 SDK 令牌解码只控制 UI；Neon/Worker 是实际授权边界，不增加 financial 的 subject/issuer/audience SQL 重复校验。

## 配置与核验

主代理运行 `node scripts/setup-auth0-rbac.mjs` 只读查看，明确授权后运行 `node scripts/setup-auth0-rbac.mjs --apply`。脚本保留原 scopes，追加应用权限，更新已有自定义 API，并回读验证 API 与 superadmin 分配；不输出凭据、不创建新角色/API、不修改登录连接、其他角色或系统 Management API。

真实 JWT/API、本地相关单元、Linux 视觉、CI 与自动部署分别记录。普通用户不改变生产角色来模拟；负向 JWT 与 owner 隔离由签名测试/接口夹具验证。真实普通用户登录须独立核验。

## 正常登录专项核验

本机财务脚本 `apps/financial/scripts/auth0-token.mjs` 程序化执行正常 Universal Login 账号页/密码页、Cookie 会话、Authorization Code + PKCE，供真实 API 专项检查；生产继续使用官方 SDK，不包含该脚本。

按既有授权，本地忽略的 `.env` 可保存 `AUTH0_TEST_EMAIL` / `AUTH0_TEST_PASSWORD`，权限 600，不使用 `VITE_` 前缀、不进入构建。脚本严格校验 callback state，凭据仅提交同一 Auth0 origin，不需要管理 CLI 登录、client secret、临时 grant 或改写 `.env`；遇 MFA/CAPTCHA 等额外验证明确停止。凭据读取/输出约束见根 [AGENTS](../AGENTS.md#全局约束)。

独立验证财务/博客 Data API 的真实读取、草稿或零行 PATCH 权限。还须验证无 token/错误签名/audience 拒绝。公开内容 HTTP 200 不能证明管理员写权限。合成夹具、真实 JWT/API、第三方完整账号登录和生产部署分别记录，通用流程见[TESTING](TESTING.md#浏览器与真实链路)。

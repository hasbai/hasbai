# 北极小站授权规则

适用于本仓库全部应用；实现入口为 `packages/auth/src/config.ts`、`auth0/login-claims.js` 与各 Worker auth 模块。Auth0 权限与 Portal 配置于 2026-10-13 更新，实际操作须回读核对。

## 统一登录与身份字段

- 浏览器共用 `packages/auth` 官方 SPA SDK 工厂（Authorization Code + PKCE），使用 SDK `localstorage` 持久缓存并启用轮换刷新令牌（两个业务 audience 均允许 Offline Access）；请求使用 `getTokenSilently`，缺少刷新令牌时回退 Auth0 会话恢复。退出清除当前站点 SDK 缓存与查询缓存。生产代码不处理密码。
- 公开登录域名 `auth.hasbai.xyz`，管理租户 `hasbai.eu.auth0.com`；北极小站组织、client ID 与默认 audience 由共享配置引用。统一提供邮箱、Google、Microsoft Account、GitHub，不得强制 `connection=eastmoney-email`。四个连接均允许加入北极组织，邮箱支持组织内注册与验证；新用户不授予业务管理角色，不关联原身份或复制角色（Eastmoney 组织保留）。
- 提供商 callback 为 `https://auth.hasbai.xyz/login/callback`；各应用 callback 为自身 `/auth/callback`，localhost origin 按应用端口登记。Worker issuer/JWKS 使用自定义域名；Neon 既有同租户 provider/JWKS 取钥地址保留。
- Action 签发顶层 `username`、`email`、`_roles`（兼容数组）与 `role`（数据库标量：共享 audience 下 `superadmin` 角色为 `superadmin`，其他账号或 audience 为 `authenticated`）；保留 blocked、邮箱验证与东方财富组织字段。
- 应用管理员授权使用原生 `permissions`，不以 `_roles` 回退。数据库标量 `role`、GRANT/RLS 与前端 `permissions` 是不同执行点，不能互相替代；旧令牌须重新登录或到期更新。服务端仍验证签名、issuer、audience、有效期和 `sub`，拒绝机器令牌；前端解码只控制 UI，不增加 Financial SQL 重复校验。

## 应用与接口边界

| 应用 | 匿名 | 普通登录用户 | Super Admin / 管理员权限 | 执行点与隔离 |
| --- | --- | --- | --- | --- |
| 博客 | 读取已发布且到期的文章、手记、独立页面与图片 | 同公开范围，无编辑权限 | `blog.all:all`：编辑室、编辑请求与 MCP 管理 | MCP 使用共享 JWT；Data API 执行 GRANT/RLS |
| 图床 | 读取公开图片 | 上传、生成和管理本人图片 | `images.all:all`：管理全部图片 | Worker 验签 JWT；数据库使用 `images_service` 角色 |
| 北极账本 | 无财务访问 | 无财务访问 | `financial.all:all`：全部财务功能 | Data API 使用 `role=superadmin` 及 schema/对象 GRANT |
| 酒馆 | 无私有数据或对话 | 搜卡/安装、本人角色/世界书/会话/设置、白名单模型选择 | `tavern.all:all`：全站敏感操作（应用提示词 PUT `/api/prompts`、Telegram 菜单同步及未来全站管理） | 业务接口以 `sub` 隔离本人数据；普通用户与管理员均不能经本人接口跨 owner 读写 |
| AI 服务 | 无 | 调用公开 `/v1/*` 模型与工作台 | `ai.all:all`：Provider 与 BYOK 管理 | `ai.hasbai.xyz` 复用共享 audience；公共调用日志归属来自 JWT |
| 微信 Bot | 仅 `/health` | 无 | `wechat.all:all`：`POST /mcp` 登录与收发 | 按 `sub` 隔离每用户 DO，不接受 owner 参数 |
| Zboard | 无账户访问；订阅与 Node token 为独立协议 | `/api/me`、`/api/me/rotate`（首次登录默认禁用） | `zboard.all:all`：`/api/admin/**` 管理 | 独立 audience；Worker 验签后判断管理员 |

酒馆 Telegram `/api/messaging/telegram` 按 `sub` 隔离；Webhook 仅验 Telegram secret。单次绑定码或按对话 ID 绑定均验证 Auth0 身份，群绑定另查 Telegram 群管理员身份并新建独立群会话，控制命令仅限绑定账号执行（详见 [MESSAGING](tavern/MESSAGING.md)）。

## 已有 Auth0 API 与权限

应用全量管理权限统一采用 `scope.resource:action`（`financial.all:all`、`blog.all:all`、`images.all:all`、`tavern.all:all`、`ai.all:all`、`wechat.all:all`、`zboard.all:all`，另同 audience 的外部 Vaultwarden 使用 `vaultwarden.all:all`）。代码拒绝已移除的旧权限名。

| API | Audience | 用途 | Access Token 权限（`enforce_policies=true`、`access_token_authz`） |
| --- | --- | --- | --- |
| financial | `https://financial.hasbai.xyz/api` | 财务、博客、图床、酒馆、AI、微信、Vaultwarden | `financial.all:all`、`blog.all:all`、`images.all:all`、`tavern.all:all`、`ai.all:all`、`wechat.all:all`、`vaultwarden.all:all` |
| Zboard API | `https://zboard.hasbai.xyz/api` | 独立 Zboard | `zboard.all:all` |
| Tavern API | `https://tavern.hasbai.xyz/api` | 历史保留（当前不请求） | 空 |
| eastmoney gateway | `https://eastmoney.hasbai.xyz/` | 其他业务保留 | 原有 61 项权限 |
| Auth0 Management API | 租户 `/api/v2/` | 系统管理 | 不向业务用户扩大授权 |

上述权限仅授予已有 tenant `superadmin` 角色，由 Auth0 原生生成至 `permissions`。租户 `authenticated` 为东方财富旧组织角色，不得作为北极小站新用户默认角色（顶层标量 `role=authenticated` 仅用于 Neon）。

## 配置与核验

- **权限脚本**：`node scripts/setup-auth0-rbac.mjs` 只读核查；明确授权后 `--apply` 更新已有自定义 API 与 `superadmin` 授权并回读验证，不输出凭据、不新建角色或 API。
- **Blog MCP Portal**：独立 Regular Web Auth0 应用与同组织；Access 允许所有登录用户，Portal 保存各用户共享 audience Token，工具调用时检查 `blog.all:all`（2026-10-13 真实管理员与无角色合成账号读写隔离验收通过）。
- **正常登录专项核验**：`apps/financial/scripts/auth0-token.mjs` 程序化执行 Universal Login PKCE（生产仍用官方 SDK）。本地忽略 `.env`（权限 `600`，无 `VITE_` 前缀）可保存 `AUTH0_TEST_EMAIL` / `AUTH0_TEST_PASSWORD`；遇 MFA/CAPTCHA 明确停止，凭据保护见 [AGENTS](../AGENTS.md#全局约束)。普通用户由无角色合成账号或负向签名测试验收，不改动生产角色。

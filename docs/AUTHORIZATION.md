# 北极小站授权规则

本规则适用于本仓库全部应用。实现入口为 `packages/auth/src/config.ts`、`auth0/login-claims.js` 与各 Worker auth 模块。Auth0 权限与 Portal 配置于 2026-10-13 更新。实际操作前必须回读核对。

## 统一登录与身份字段

- 浏览器共用 `packages/auth` 官方 SPA SDK 工厂（Authorization Code + PKCE）。SDK 使用 `localstorage` 持久缓存，并启用轮换刷新令牌（两个业务 audience 均开启 Offline Access）。请求使用 `getTokenSilently`。缺少刷新令牌时，回退至 Auth0 会话恢复。退出会清除当前站点 SDK 缓存与查询缓存。生产代码不得处理密码。
- 公开登录域名为 `auth.hasbai.xyz`，管理租户为 `hasbai.eu.auth0.com`。北极小站组织、client ID 与默认 audience 由共享配置引用。登录支持邮箱、Google、Microsoft Account 与 GitHub，不得强制 `connection=eastmoney-email`。这四个连接均可以加入北极组织。邮箱支持组织内注册与验证。新用户不授予业务管理角色，也不关联原身份或复制角色（Eastmoney 组织配置保留）。
- 提供商 callback 为 `https://auth.hasbai.xyz/login/callback`。各应用 callback 为自身 `/auth/callback`，localhost origin 按应用端口登记。Worker issuer 与 JWKS 使用自定义域名。Neon 既有同租户 provider 与 JWKS 取钥地址保留。
- Action 签发顶层 `username`、`email`、`_roles`（兼容数组）与 `role`。共享 audience 下具备 `superadmin` 角色时，`role` 为 `superadmin`。其他账号或 audience 下，`role` 为 `authenticated`。Action 保留 blocked、邮箱验证与东方财富组织字段。
- 应用管理员授权使用原生 `permissions`，不得以 `_roles` 回退。数据库标量 `role`、GRANT/RLS 与前端 `permissions` 为不同执行点，不得互相替代。旧令牌必须重新登录或到期更新。服务端验证签名、issuer、audience、有效期与 `sub`，并拒绝机器令牌。前端解码只控制 UI，不得在 Financial SQL 增加重复校验。

## 应用与接口边界

| 应用 | 匿名 | 普通登录用户 | Super Admin / 管理员权限 | 执行点与隔离 |
| --- | --- | --- | --- | --- |
| 博客 | 读取已发布且到期的文章、手记、独立页面与图片 | 同公开范围，无编辑权限 | `blog.all:all`：编辑室、编辑请求与 MCP 管理 | MCP 使用共享 JWT。Data API 执行 GRANT/RLS。 |
| 图床 | 读取公开图片 | 上传、生成与管理本人图片 | `images.all:all`：管理全部图片 | Worker 验签 JWT。数据库使用 `images_service` 角色。 |
| 北极账本 | 无财务访问 | 无财务访问 | `financial.all:all`：全部财务功能 | Data API 使用 `role=superadmin` 及 schema/对象 GRANT。 |
| 酒馆 | 无私有数据或对话 | 搜卡与安装、管理本人资源、白名单选模 | `tavern.all:all`：全站敏感操作（`PUT /api/prompts`、Telegram 菜单同步与未来全站管理） | 业务接口按 `sub` 隔离本人数据。普通用户与管理员均不得经本人接口跨 owner 读写。 |
| AI 服务 | 无 | 调用公开 `/v1/*` 模型与工作台 | `ai.all:all`：Provider 与 BYOK 管理 | `ai.hasbai.xyz` 复用共享 audience。公共调用日志归属来自 JWT。 |
| 微信 Bot | 仅 `/health` | 无 | `wechat.all:all`：`POST /mcp` 登录与收发 | 按 `sub` 隔离每用户 DO，不接受 owner 参数。 |
| Zboard | 无账户访问。订阅与 Node token 为独立协议 | `/api/me`、`/api/me/rotate`（首次登录默认禁用） | `zboard.all:all`：`/api/admin/**` 管理 | 独立 audience。Worker 验签后判断管理员。 |

酒馆 `/api/messaging/telegram` 按 `sub` 隔离。Webhook 只验 Telegram secret。单次绑定码或按对话 ID 绑定均验证 Auth0 身份。群绑定另查 Telegram 群管理员身份，并新建独立群会话。控制命令只限绑定账号执行（详见 [MESSAGING](tavern/MESSAGING.md)）。

## 已有 Auth0 API 与权限

应用全量管理权限统一使用 `scope.resource:action` 格式。权限清单为 `financial.all:all`、`blog.all:all`、`images.all:all`、`tavern.all:all`、`ai.all:all`、`wechat.all:all` 与 `zboard.all:all`（同 audience 的外部 Vaultwarden 使用 `vaultwarden.all:all`）。代码拒绝已移除的旧权限名。

| API | Audience | 用途 | Access Token 权限（`enforce_policies=true`、`access_token_authz`） |
| --- | --- | --- | --- |
| financial | `https://financial.hasbai.xyz/api` | 财务、博客、图床、酒馆、AI、微信、Vaultwarden | `financial.all:all`、`blog.all:all`、`images.all:all`、`tavern.all:all`、`ai.all:all`、`wechat.all:all`、`vaultwarden.all:all` |
| Zboard API | `https://zboard.hasbai.xyz/api` | 独立 Zboard | `zboard.all:all` |
| Tavern API | `https://tavern.hasbai.xyz/api` | 历史保留（当前不请求） | 空 |
| eastmoney gateway | `https://eastmoney.hasbai.xyz/` | 其他业务保留 | 原有 61 项权限 |
| Auth0 Management API | 租户 `/api/v2/` | 系统管理 | 不向业务用户扩大授权 |

上述权限只授予已有 tenant `superadmin` 角色，由 Auth0 原生生成至 `permissions`。租户 `authenticated` 为东方财富旧组织角色，不得作为北极小站新用户默认角色。顶层标量 `role=authenticated` 只用于 Neon。

## 配置与核验

- **权限脚本**：`node scripts/setup-auth0-rbac.mjs` 默认只读核查。取得明确授权后，运行 `--apply` 更新已有自定义 API 与 `superadmin` 授权并回读验证。该脚本不输出凭据，也不新建角色或 API。
- **Blog MCP Portal**：使用独立 Regular Web Auth0 应用与同组织。Access 放行所有登录用户。Portal 保存各用户共享 audience Token，工具调用时检查 `blog.all:all`（2026-10-13 真实管理员与无角色合成账号读写隔离验收通过）。
- **正常登录专项核验**：`apps/financial/scripts/auth0-token.mjs` 用程序执行 Universal Login PKCE（生产仍使用官方 SDK）。本地忽略文件 `.env`（权限 `600`，无 `VITE_` 前缀）可以保存 `AUTH0_TEST_EMAIL` 与 `AUTH0_TEST_PASSWORD`。遇 MFA 或 CAPTCHA 时，脚本必须停止。凭据保护规则见 [AGENTS](../AGENTS.md#全局约束)。普通用户通过无角色合成账号或负向签名测试验收，不得改动生产角色。

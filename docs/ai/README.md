# AI · 统一模型服务

`apps/ai` 是统一 AI Worker，域名为 `ai.hasbai.xyz`。
调用客户端位于 `packages/ai`。上游使用 Cloudflare AI Gateway `default`。

## 身份与权限

网页复用 `packages/auth` 和现有 Auth0 Universal Login。
普通登录用户可调用模型，无需业务角色。
管理接口验证原生 `ai.all:all` 权限，仅授予既有 `superadmin`。
接口不使用 `role` 或 `_roles` 代替权限。
公共调用的日志身份来自已验证 JWT，不接受客户端覆盖。

应用间使用指向 `InferenceService` 的 `AI_SERVICE` 服务绑定。
原应用负责验证用户，服务绑定传递可信日志归属。
默认公开入口拒绝 `/internal/*`，不能绕过 Auth0。

## 调用映射

| 调用方 | 用途 | 上游 |
| --- | --- | --- |
| Tavern | 正文、Director、摘要 | `default/compat/chat/completions`，使用会话所选对话模型 |
| Tavern | 角色生成 | 同一入口，默认 `dynamic/rp` |
| Tavern | 向量检索 | Workers AI `@cf/baai/bge-m3`，同一 Gateway |
| Blog | 翻译 | `default/compat/chat/completions`，`dynamic/translate` |
| Images | 图片、头像、立绘 | `default/custom-codex/images/generations` |

图片模型仍限制为 Flare 和 Sunburst。
Worker 根据平台目录映射对话模型，调用方不能覆盖 URL、Gateway 或运行凭据。
直连图片接口使用 `cf-aig-byok-alias: default`。
动态路由的密钥选择由 Cloudflare 路由配置决定。
流式响应不缓冲，保留状态、Gateway log ID 和取消信号。
请求不重试、不跟随重定向，日志保留完整 payload。

## 公共 API

以下接口均要求 Auth0 用户访问令牌。
使用共享 audience，规则见 [AUTHORIZATION](../AUTHORIZATION.md)。

| 接口 | 请求 |
| --- | --- |
| `GET /v1/models` | 查询模型 ID、显示名称和类型（chat / image / embedding） |
| `POST /v1/chat/completions` | OpenAI 格式；`model` 为 `rp` 或 `translate`，支持 SSE |
| `POST /v1/images/generations` | `model` 为完整图片模型 ID |
| `POST /v1/embeddings` | `model=@cf/baai/bge-m3`，`input` 为字符串或字符串数组 |
| `GET /api/me` | 当前身份与管理权限 |

工作台提供流式对话。API 提供图片和向量调用。
真实模型输出仍由各业务应用按原契约校验。

`worker/models.ts` 统一维护模型目录与对话路由校验。服务绑定的 `GET /internal/models` 和公共 `/v1/models` 返回相同目录。公共 HTTP 仍拒绝 `/internal/*`。Tavern 仅展示 `chat` 类型；所选模型传至平台，平台拒绝未知 ID。兼容旧应用提交的 `dynamic/rp` 与 `dynamic/translate`，不会把未知模型替换为默认模型。

## Provider 与 BYOK

工作台仅向管理员显示 Provider 和密钥管理。
自定义 Provider 属于 Cloudflare 账号；BYOK 属于选定 Gateway。
配置直接保存在 Cloudflare，不另建配置数据库。

| 管理接口 | 方法 |
| --- | --- |
| `/api/admin/gateways` | GET |
| `/api/admin/providers` | GET、POST |
| `/api/admin/providers/:id` | GET、PATCH、DELETE |
| `/api/admin/gateways/:gateway/keys` | GET、POST |
| `/api/admin/gateways/:gateway/keys/:id` | GET、PUT、DELETE |

列表接受 `page`，每页最多 100 项。
Provider 支持名称、slug、HTTPS 地址、说明和启用状态。
BYOK 新增时提交 `provider_slug`、`alias`、`default_config` 和 `secret`。
PUT 仅轮换 `secret`，不改变 alias。

密钥直接写入 Cloudflare 配置的 Secrets Store，保存后不回显。
管理响应按字段白名单返回，不转发 Provider headers、密钥或原始错误。
页面在提交或关闭密钥表单时清空输入，不写入本地存储。

## 配置与发布

当前按用户要求共用一个 Cloudflare Token。
该 Token 需 AI Gateway Run、AI Gateway Write 和 Secrets Store Write 权限。
资源限定到当前账号，同一个值配置为 `AIG_RUN_TOKEN` 和 `CF_AI_MANAGEMENT_TOKEN`。
凭据只保存在 AI Worker Secret，不进入浏览器或其他应用。
本地启动 API 使用应用目录中的 Wrangler 开发入口。

发布顺序必须保持：

1. 用 `node scripts/setup-ai-auth0.mjs --apply` 注册新站点 URL 与管理员权限。
2. 先发布 AI Worker，配置两项 Secret，并核验真实 JWT 与上游。
3. 再发布 Blog、Images 和 Tavern 的服务绑定迁移。
4. 核验调用后，移除旧应用中不再使用的运行 Secret。

沿用 Workers Builds 自动部署。新 Worker 需单独关联仓库构建配置。
不可假定独立应用的自动构建按依赖顺序完成。
Auth0 配置脚本要求现有管理 CLI 登录，不创建凭据文件。

本地检查为 `pnpm --filter ai-service typecheck`、`test`、`test:runtime` 和 `build`。
工作台与 CI 使用固定 AMD64 Chromium 镜像生成、审阅和严格比较基线。

运行时测试使用仓库固定 workerd 支持的兼容日期 `2026-10-16`。
生产配置日期为 `2026-11-07`，须另行核验生产运行时。
仓库通用交付要求见 [TESTING](../TESTING.md)。

## 官方契约

- [自定义 Provider](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/)
- [BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)
- [服务绑定](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)

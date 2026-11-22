# AI · 统一模型服务

`apps/ai` 是统一 AI Worker（`ai.hasbai.xyz`）。调用客户端位于 `packages/ai`。上游为 Cloudflare AI Gateway `default`。

## 身份与权限

- 网页复用 `packages/auth` 与 Auth0 Universal Login（共享 audience，见 [AUTHORIZATION](../AUTHORIZATION.md)）。普通登录用户可以调用模型。管理接口验证原生 `ai.all:all`（只授予 `superadmin`，不得以 `role` 或 `_roles` 回退）。公共调用日志身份取自已验证 JWT。
- 应用间经指向 `InferenceService` 的 `AI_SERVICE` 服务绑定调用。调用方负责验证用户，并传递可信归属。公开 HTTP 入口拒绝 `/internal/*`。

## 调用映射

| 调用方 | 用途 | 上游 |
| --- | --- | --- |
| Tavern | 正文、Director、摘要 | `default/compat/chat/completions`（会话所选对话模型） |
| Tavern | 角色生成 | 同上（平台默认对话模型） |
| Tavern | 向量检索 | Workers AI `@cf/baai/bge-m3`（经同一 Gateway） |
| Blog | 翻译 | 同上（`TRANSLATE_MODEL`，未配置则取平台默认对话模型） |
| Images | 图片、头像、立绘 | `default/custom-codex/images/generations`（只限 Flare 与 Sunburst） |

Worker 根据平台目录映射对话模型。调用方不得覆盖 URL、Gateway 或运行凭据。直接调用 Provider 模型与直连图片接口时，携带 `cf-aig-byok-alias: default`。动态路由使用 `dynamic/<name>`。流式响应不缓冲，保留状态、Gateway log ID 与取消信号。请求不重试、不跟随重定向，日志保留完整 payload。

## 公共 API 与工作台

以下接口均要求 Auth0 用户访问令牌：

| 接口 | 契约 |
| --- | --- |
| `GET /v1/models` | 返回模型 ID、显示名称与类型（`chat`/`image`/`embedding`），与 `/internal/models` 一致 |
| `POST /v1/chat/completions` | OpenAI 格式，支持 SSE。`model` 必须明确指定目录对话模型 ID（省略、空值或 `default` 返回 400） |
| `POST /v1/images/generations` | `model` 为完整图片模型 ID |
| `POST /v1/embeddings` | `model=@cf/baai/bge-m3`，`input` 为字符串或数组 |
| `GET /api/me` | 当前身份与管理权限 |

工作台使用酒馆式阅读列与底部输入框。页面支持连续流式对话、停止与复制。对话只存页面内存，刷新后清空。新对话不预选或沿用上次模型。弹层按 Provider 展示模型卡片与已知 `context_tokens`（未知不推测），关闭后恢复触发器焦点。向上阅读时，界面不强制滚底。停止或失败保留草稿，后续请求只带已完成轮次。

## 模型发现

`worker/discovery.ts` 与 `worker/routes.ts` 分别发现自定义 Provider 模型与当前已部署动态路由：

1. 用管理 Token 读取账号下已启用自定义 Provider。
2. 经 `gateway.ai.cloudflare.com` 请求 `custom-<slug>/models`（带运行 Token 与 BYOK `default`，不写日志，不跟随重定向）。单 Provider 超时 5 秒，响应上限 256 KB，最多 200 个模型。
3. 对话模型 ID 为 `custom-<slug>/<模型>`（匹配 `packages/ai` 的 `MODEL_ID`）。系统过滤含 `image`、`embed`、`bge`、`whisper`、`tts`、`rerank`、`moderation` 的条目。有效 `context_length` 或 `max_model_len`（≥ 1024）映射为 `context_tokens`，并附 `provider` slug。目录不返回 `base_url`、Provider ID、请求头或上游错误正文。
4. 目录在 Worker 实例内缓存 5 分钟。并发刷新共享同一请求，管理改动后当实例立即失效。单 Provider 失败时沿用最近缓存最长 1 小时（失败后 30 秒内不重试）。无可用缓存时返回 503。
5. 动态路由每次直读 Cloudflare 当前配置。一方失败时保留另一方，均失败时返回 503。
6. 公共对话不含虚拟 `default` 模型。服务绑定兼容路径接受省略或 `default`（取 `DEFAULT_CHAT_MODEL` 或首个可用模型，未发现则返回 503）。`rp` 与 `translate` 旧 ID 解析为同名动态路由。Tavern 默认使用 `dynamic/rp`。

## Provider、BYOK 与动态路由管理

工作台只向 `ai.all:all` 管理员显示 Provider、BYOK（直接写入 Secrets Store）与 `default` Gateway 动态路由管理。本模块不另建数据库。列表 `page` 每页最多 100 项。响应按白名单返回，不回显密钥、headers 或原始 `data`。

| 管理接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/admin/gateways` | GET | Gateway 列表 |
| `/api/admin/providers` 与 `/:id` | GET、POST、PATCH、DELETE | 名称、slug、HTTPS 地址、说明与启停 |
| `/api/admin/gateways/:gateway/keys` 与 `/:id` | GET、POST、PUT、DELETE | 新增密钥（`provider_slug`、`alias`、`default_config`、`secret`）。PUT 只轮换密钥 |
| `/api/admin/gateways/:gateway/routes` 与 `/:id` | GET、POST、PATCH、DELETE | 路由增删与重命名 |
| `/api/admin/gateways/:gateway/routes/:id/versions` | GET、POST | 保存版本（节点卡片或高级 JSON）。保存不自动发布 |
| `/api/admin/gateways/:gateway/routes/:id/deployments` | POST | 发布指定版本（旧版本发布即回滚）并刷新目录 |

## 配置与发布

共用同一账号级 Cloudflare Token（具备 AI Gateway Run/Write 与 Secrets Store Write 权限）。该 Token 配置为 AI Worker Secret `AIG_RUN_TOKEN` 与 `CF_AI_MANAGEMENT_TOKEN`。凭据不得进入浏览器或其他应用。发布顺序：

1. 登录管理 CLI 后，运行 `node scripts/setup-ai-auth0.mjs --apply` 注册站点 URL 与管理员权限。
2. 发布 AI Worker 并配置两项 Secret。
3. 用管理员令牌验证 `GET /v1/models` 与一次真实对话。
4. 发布 Blog、Images 与 Tavern 服务绑定迁移。
5. 核验调用后，清理旧应用冗余运行 Secret。

本地检查与截图见 [TESTING](../TESTING.md)。测试命令为 `pnpm --filter ai-service typecheck`、`test`、`test:runtime` 与 `build`。运行时测试兼容日期为 `2026-10-16`，生产配置日期为 `2026-11-07`。发布前必须另行核验生产运行时。官方参考：[自定义 Provider](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/)、[BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)、[服务绑定](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)。

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
| Tavern | 角色生成 | 同一入口，使用平台默认对话模型 |
| Tavern | 向量检索 | Workers AI `@cf/baai/bge-m3`，同一 Gateway |
| Blog | 翻译 | 同一入口，使用 `TRANSLATE_MODEL`，未配置则用平台默认对话模型 |
| Images | 图片、头像、立绘 | `default/custom-codex/images/generations` |

图片模型仍限制为 Flare 和 Sunburst。
Worker 根据平台目录映射对话模型，调用方不能覆盖 URL、Gateway 或运行凭据。
直连图片接口使用 `cf-aig-byok-alias: default`。
对话模型不使用 Cloudflare 动态路由。上游模型由 Worker 自动发现，请求带 `cf-aig-byok-alias: default` 选择 BYOK 密钥。
流式响应不缓冲，保留状态、Gateway log ID 和取消信号。
请求不重试、不跟随重定向，日志保留完整 payload。

## 公共 API

以下接口均要求 Auth0 用户访问令牌。
使用共享 audience，规则见 [AUTHORIZATION](../AUTHORIZATION.md)。

| 接口 | 请求 |
| --- | --- |
| `GET /v1/models` | 查询模型 ID、显示名称和类型（chat / image / embedding） |
| `POST /v1/chat/completions` | OpenAI 格式；`model` 为 `/v1/models` 返回的对话模型 ID，省略或 `default` 用平台默认，支持 SSE |
| `POST /v1/images/generations` | `model` 为完整图片模型 ID |
| `POST /v1/embeddings` | `model=@cf/baai/bge-m3`，`input` 为字符串或字符串数组 |
| `GET /api/me` | 当前身份与管理权限 |

工作台提供流式对话。API 提供图片和向量调用。
真实模型输出仍由各业务应用按原契约校验。

## 模型发现

`worker/discovery.ts` 自动发现上游对话模型，不再手写目录，也不使用 Cloudflare 动态路由。

1. 用管理 Token 读取 Cloudflare 账号下已启用的自定义 Provider。
2. 对每个 Provider 经 Gateway 请求 `custom-<slug>/models`（OpenAI 格式 `data[].id`），带运行 Token 和 BYOK alias `default`，不写 Gateway 日志。
3. 对话模型 ID 为 `custom-<slug>/<模型>`，原样作为 `compat/chat/completions` 的 `model`。名称含 image、embed、bge、whisper、tts、rerank、moderation 的条目不进入对话目录。
4. 条目带 `context_length` 或 `max_model_len`（不小于 1024 的整数）时，目录返回 `context_tokens`。每个对话条目带 `provider`（Provider slug，不含 `custom-` 前缀），供客户端分组。

目录在 Worker 实例内缓存 5 分钟，并发刷新共享同一请求；管理接口改动 Provider 或 BYOK 密钥后，处理该请求的 Worker 实例立即失效，其他实例等 TTL。单个 Provider 失败时沿用其最近一次成功结果，最长 1 小时。刷新失败后 30 秒内不再重试，直接用缓存（超过 1 小时则返回 503）。没有可用缓存时 `/v1/models` 和对话返回 503，不转发未经验证的模型 ID。发现依赖管理 Token（读取 Provider 列表，5 秒超时）。

请求限制：只访问 `gateway.ai.cloudflare.com`，不跟随重定向，每个 Provider 超时 5 秒，响应上限 256 KB，每个 Provider 最多 200 个模型，ID 须匹配 `packages/ai` 的 `MODEL_ID`。目录不返回 `base_url`、Provider ID、请求头或上游错误正文。

`worker/models.ts` 合并发现结果与固定的图片、向量模型。服务绑定的 `GET /internal/models` 和公共 `/v1/models` 返回相同目录，公共 HTTP 仍拒绝 `/internal/*`。

目录首项是虚拟条目 `default`，含 `target`（实际模型 ID）。`DEFAULT_CHAT_MODEL` 变量指定默认模型；已配置但未被发现时返回 503，不换用其他模型；未配置时取第一个发现的模型，上线前须核对 `/v1/models` 首项 `target`，并按需固定该变量。`TRANSLATE_MODEL` 未配置或未被发现时，翻译使用默认模型。默认模型不可用时，列表省略 `default`，明确指定的已发现模型仍可使用。平台拒绝未知 ID，不替换为默认模型。

滚动发布期间仍接受旧应用提交的 `rp`、`dynamic/rp`（解析为默认模型）以及 `translate`、`dynamic/translate`（解析为翻译模型），后续发布移除。Tavern 仅展示 `chat` 类型，所选 ID 传至平台。

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
2. 先发布 AI Worker，配置两项 Secret，并核验真实 JWT 与上游。用管理员令牌调用 `GET /v1/models`，确认每个 Provider 的 `/models` 经 Gateway 可达，并用一个发现的模型完成一次真实对话。`DEFAULT_CHAT_MODEL` 与 `TRANSLATE_MODEL` 为空时自动取默认。
3. 再发布 Blog、Images 和 Tavern 的服务绑定迁移。
4. 核验调用后，移除旧应用中不再使用的运行 Secret。

沿用 Workers Builds 自动部署。新 Worker 需单独关联仓库构建配置。
不可假定独立应用的自动构建按依赖顺序完成。
Auth0 配置脚本要求现有管理 CLI 登录，不创建凭据文件。

本地检查为 `pnpm --filter ai-service typecheck`、`test`、`test:runtime` 和 `build`。
工作台与 CI 使用固定 ARM64 Chromium 镜像生成、审阅和严格比较基线。

运行时测试使用仓库固定 workerd 支持的兼容日期 `2026-10-16`。
生产配置日期为 `2026-11-07`，须另行核验生产运行时。
仓库通用交付要求见 [TESTING](../TESTING.md)。

## 官方契约

- [自定义 Provider](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/)
- [BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)
- [服务绑定](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)

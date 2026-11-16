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
对话模型包含自动发现的 Provider 模型和已部署的 Cloudflare 动态路由。
直接调用 Provider 模型时，请求带 `cf-aig-byok-alias: default` 选择 BYOK 密钥。
动态路由使用 `dynamic/<name>`，由 Gateway 的已部署规则选择模型。

流式响应不缓冲，保留状态、Gateway log ID 和取消信号。
请求不重试、不跟随重定向，日志保留完整 payload。

## 公共 API

以下接口均要求 Auth0 用户访问令牌。
使用共享 audience，规则见 [AUTHORIZATION](../AUTHORIZATION.md)。

| 接口 | 请求 |
| --- | --- |
| `GET /v1/models` | 查询模型 ID、显示名称和类型（chat / image / embedding） |
| `POST /v1/chat/completions` | OpenAI 格式；`model` 必须明确指定 `/v1/models` 返回的对话模型 ID，支持 SSE。省略、空值和 `default` 返回 400 |
| `POST /v1/images/generations` | `model` 为完整图片模型 ID |
| `POST /v1/embeddings` | `model=@cf/baai/bge-m3`，`input` 为字符串或字符串数组 |
| `GET /api/me` | 当前身份与管理权限 |

工作台采用酒馆式阅读列和底部输入框，支持连续流式对话、停止和复制回复。
新对话不预选模型，也不沿用上次选择。模型选择使用完整弹层，按 Provider 展示模型卡片。
卡片展示模型 ID、调用方式及上游提供的上下文长度；未知值不推测。

选择后关闭弹层；关闭按钮、Escape 和点击外部均可收起，并恢复触发器焦点。
消息区独立滚动；用户向上阅读时，流式输出不强制滚到底部。
停止或失败保留草稿与未完成回复；后续请求只带已完成的对话轮次。

当前对话保存在页面内存中，刷新后清空。API 提供图片和向量调用。
真实模型输出仍由各业务应用按原契约校验。

## 模型发现

`worker/discovery.ts` 自动发现上游对话模型。`worker/routes.ts` 读取当前 Gateway 的已部署动态路由。

1. 用管理 Token 读取 Cloudflare 账号下已启用的自定义 Provider。
2. 对每个 Provider 经 Gateway 请求 `custom-<slug>/models`（OpenAI 格式 `data[].id`），带运行 Token 和 BYOK alias `default`，不写 Gateway 日志。
3. 对话模型 ID 为 `custom-<slug>/<模型>`，原样作为 `compat/chat/completions` 的 `model`。名称含 image、embed、bge、whisper、tts、rerank、moderation 的条目不进入对话目录。
4. 条目带 `context_length` 或 `max_model_len`（不小于 1024 的整数）时，目录返回 `context_tokens`。每个对话条目带 `provider`（Provider slug，不含 `custom-` 前缀），供客户端分组。

目录在 Worker 实例内缓存 5 分钟，并发刷新共享同一请求；管理接口改动 Provider 或 BYOK 密钥后，处理该请求的 Worker 实例立即失效，其他实例等 TTL。单个 Provider 失败时沿用其最近一次成功结果，最长 1 小时。刷新失败后 30 秒内不再重试，直接用缓存（超过 1 小时则返回 503）。没有可用缓存时 `/v1/models` 和对话返回 503，不转发未经验证的模型 ID。发现依赖管理 Token（读取 Provider 列表，5 秒超时）。

请求限制：只访问 `gateway.ai.cloudflare.com`，不跟随重定向，每个 Provider 超时 5 秒，响应上限 256 KB，每个 Provider 最多 200 个模型，ID 须匹配 `packages/ai` 的 `MODEL_ID`。目录不返回 `base_url`、Provider ID、请求头或上游错误正文。

`worker/models.ts` 合并发现结果与固定的图片、向量模型。服务绑定的 `GET /internal/models` 和公共 `/v1/models` 返回相同目录，公共 HTTP 仍拒绝 `/internal/*`。

目录不包含 `default` 虚拟模型。公共对话 API 必须明确选择模型或动态路由。
目录中的 Provider 模型和动态路由分别读取；一方失败时保留另一方可用条目。
两方均失败时返回 503。动态路由每次读取当前 Cloudflare 配置，不使用旧缓存。

为保留现有业务应用的兼容性，服务绑定暂时接受省略模型和 `default`。
仅此兼容路径沿用 `DEFAULT_CHAT_MODEL`，为空时取首个发现的模型。

固定默认模型未发现时返回 503；明确指定的模型仍可使用。
翻译未明确指定模型时沿用 `TRANSLATE_MODEL`，不可用则走该兼容路径。
`rp` 和 `translate` 旧 ID 解析为同名动态路由，不再替换成 Provider 首个模型。
未知或未部署的路由拒绝调用；明确选择的模型不被翻译用途覆盖。

本次只修改 AI 平台，不修改、部署或接入 Tavern。酒馆待平台验收后再接入。

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

## 动态路由管理

仅 `ai.all:all` 管理员可以创建、编辑、删除路由和管理版本。
配置保存在当前 Gateway 的 Cloudflare 动态路由中，不另建数据库。

| 管理接口 | 方法 |
| --- | --- |
| `/api/admin/gateways/:gateway/routes` | GET、POST |
| `/api/admin/gateways/:gateway/routes/:id` | GET、PATCH（重命名）、DELETE |
| `/api/admin/gateways/:gateway/routes/:id/versions` | GET、POST（保存版本） |
| `/api/admin/gateways/:gateway/routes/:id/deployments` | POST（发布指定版本） |

页面管理 `default` Gateway。模型节点提供模型卡片选择及 Provider、模型 ID、超时和重试表单。
高级编辑器使用 Cloudflare 节点 JSON，支持条件、百分比分流、限流和模型回退。
保存版本不自动发布；管理员在版本界面明确发布，发布旧版本即可回滚。

创建后同样检查版本并明确发布。部署成功后刷新可选模型目录。

Worker 校验节点 ID、起点、终点和连线目标，并按白名单返回字段。
不返回版本原始 `data`、Provider headers 或密钥。


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
截图与基线使用执行环境对应的固定 Chromium 镜像：云环境统一使用 AMD64，本地 ARM64 流程见 [TESTING](../TESTING.md)。

运行时测试使用仓库固定 workerd 支持的兼容日期 `2026-10-16`。
生产配置日期为 `2026-11-07`，须另行核验生产运行时。
仓库通用交付要求见 [TESTING](../TESTING.md)。

## 官方契约

- [自定义 Provider](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/)
- [BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)
- [服务绑定](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)

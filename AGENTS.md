# Hasbai 项目指南

## 先定位应用

仓库历史名 `financial` 不代表任务属于财务。修改前先读取目标应用入口，再按任务读取其中链接的契约；财务三表/schema/基表 DML 限制只适用于 Financial。

| 应用 | 目录与 Filter | 开发端口 | 必读入口 |
| --- | --- | --- | --- |
| 财务 / 北极账本 | `apps/financial`（`financial`） | 5173（`pnpm dev`） | [财务边界与路由](docs/financial/README.md) |
| 博客 / 北极小站 | `apps/blog`（`blog`） | 5174（`pnpm dev:blog`） | [博客边界与路由](docs/blog/README.md) |
| Zboard | `apps/zboard`（`zboard`） | 5175（`pnpm dev:zboard`）/ API 8787 | [Zboard 边界与路由](docs/zboard/README.md) |
| 酒馆 / Tavern | `apps/tavern`（`tavern`） | 5176（`pnpm dev:tavern`）/ API 8787 | [Tavern 边界与路由](docs/tavern/README.md) |
| 图床 / Images | `apps/images`（`images`） | 5177（`pnpm dev:images`） | [图床边界与路由](docs/images/README.md) |
| AI / 统一模型服务 | `apps/ai`（`ai-service`） | 5178（`pnpm dev:ai`）/ API 8787 | [AI 边界与路由](docs/ai/README.md) |
| 微信 / WeChat Bot | `apps/wechat`（`wechat`） | 无前端 | [WeChat 边界与路由](docs/wechat/README.md) |

目标目录缺失时，先核对 `git status --short --branch`、`git worktree list` 与最新 `origin/main` 目录树，复用包含目标应用的干净工作区；不为定位强行切换、重置或覆盖其他任务，不要求用户重发已存在的项目地址。机器专属路径不作为永久代码入口。

## 全局约束

- 修改用户内容前，先说明具体文案、位置和范围并取得同意；问题描述、外部审核退回或合规建议不构成改稿授权。博客首页的已授权范围见[博客入口](docs/blog/README.md#内容修改边界)。
- 围绕确认需求选择直接、可维护的实现，不增加不必要的抽象、校验门槛或服务依赖，不预设计未授权能力。
- 通用能力统一放在 `packages`，优先复用 `packages/ui`，避免各应用重复通知、表单、弹层和认证。共享视觉与交互见[DESIGN](docs/DESIGN.md)。
- 登录统一使用 `packages/auth` 与 `auth.hasbai.xyz`（Auth0 Universal Login），支持邮箱、Google、Microsoft Account、GitHub；不得按应用强制单一连接。audience 与权限规则唯一入口见[AUTHORIZATION](docs/AUTHORIZATION.md)。
- 凭据文件只通过程序化读取用于已授权请求；禁止用 `cat`、`rg`、`sed` 回显配置值，禁止输出完整环境、认证头、令牌或管理 API 响应。诊断与子代理交付仅输出状态、资源 ID、构建 SHA 等非敏感元数据。浏览器只含公开配置与用户会话凭据。

## 环境与运行

- **根脚本与 API**：根 `pnpm build` / `typecheck` / `test` 默认代理 `financial`；其他应用使用 `pnpm --filter <filter> <script>`。Zboard / Tavern / AI 的本地 Worker API 先构建再启动，共用 8787 端口，每次运行一个：`node scripts/local-environment.mjs api <zboard|tavern|ai>`。
- **环境脚本**：`node scripts/local-environment.mjs <setup|info|cleanup>`。`setup` 校验 Node 24 与 pnpm `10.33.2` 后执行 `pnpm install --frozen-lockfile`（不复制其他工作树 `node_modules`）；`cleanup` 仅删除 `dist`、`dist-e2e`、`coverage`、`.svelte-kit`，保留缓存、凭据、本地数据与截图证据。配置位于 [.codex/environments/environment.toml](.codex/environments/environment.toml) 与 [.agents/environment.json](.agents/environment.json)。
- **云环境（Linux x86_64）**：开发、测试、截图和基线生成统一使用 AMD64 镜像，不运行 QEMU 模拟：
  `node scripts/cloud-dev.mjs run <命令>`（如 `node scripts/cloud-dev.mjs run env CI=true pnpm install --frozen-lockfile`、`node scripts/cloud-dev.mjs run --publish 127.0.0.1:5174:5174 -- pnpm dev:blog --host 0.0.0.0`）。pnpm store 缓存在 `.local-visual/cloud-dev-pnpm-store`；仅修改 [Dockerfile](docker/visual-ci/Dockerfile) 后运行 `node scripts/cloud-dev.mjs build`。
- **ARM64 视觉**：视觉 CI（`ubuntu-24.04-arm`）与 Apple Silicon 本地 `pnpm visual:*` 使用同 Dockerfile 发布的 Linux ARM64 镜像。云端 AMD64 截图可审阅并导入基线，不再为架构差异另行确认。
- **版本固定**：`pnpm-workspace.yaml` `catalog` 统一固定直接依赖；镜像固定 Ubuntu Noble、Node `24.20.0`、pnpm `10.33.2`、Playwright `1.63.0`（仅 Chromium headless）、Wrangler `4.148.0` 与 `workerd` override `1.20261009.1`（升级 Wrangler 时须复核并验证真实 Worker 启动）。

## 校验与交付

修改前按[TESTING](docs/TESTING.md)确认本地检查、截图、迁移与交付路径。该文档统一维护按需 PR、`ci:*` 标签、自动合并、允许直推和自动部署核验规则，应用文档不重复流程。

代码变更走 PR；文档、skills 等非代码改动按直推规则推 `main`。主代理开 PR 时必须用 `gh pr create --label ci:<应用>`（可多个，或 `ci:all`）手动声明 CI 范围，并在描述写明跳过其余应用的理由；PR 经唯一必需状态 `Hasbai CI` 后自动 squash 合并。同功能修补与 CI 修复推到同一分支与 PR，合并后新修改另开 PR。必要的隔离验证、生产迁移、真实 API 核验、提交和推送属于同一次已授权交付，不另等发布授权；兼容迁移不得只交付前端。

## 文档维护

[doc-maintenance](skills/doc-maintenance/SKILL.md) 规定 STE100 精简、审校与校验流程，[文档导航](docs/README.md)定义文档职责。共通规则只维护一处，应用细节就近放置，其他位置链接引用；当前实现、目标要求与历史证据分别标注，不把 `history/` 当当前规范。

Tavern 对话架构变更必须同步相关文档和关于页面，规则见[酒馆入口](docs/tavern/README.md#同步维护)。

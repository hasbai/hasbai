# Hasbai · 北极小站

个人使用的应用 monorepo，共享 Svelte 5、Luma UI 和北极小站登录。GitHub 仓库为 `hasbai/hasbai`，曾使用 `hasbai/financial` 名称。

| 应用 | 用途 | 代码与文档 |
| --- | --- | --- |
| 北极账本 | 资产负债、现金流、损益，流水补录、同笔退款与科目管理 | [Financial](docs/financial/README.md) · `apps/financial` |
| 北极小站 | 公开文章、手记、时间线、独立页面，在线 Markdown 编辑发布 | [Blog](docs/blog/README.md) · `apps/blog` |
| Zboard | 代理节点、用户资格、配置模板与订阅管理 | [Zboard](apps/zboard/README.md) · `apps/zboard` |
| 图床 | 图片管理、上传、AI 生成，博客与酒馆统一素材库 | [Images](docs/images/README.md) · `apps/images` |
| AI | 统一模型调用、自定义 Provider 与 BYOK 管理 | [AI](docs/ai/README.md) · `apps/ai` |
| 酒馆 | 角色卡与世界书、在线搜卡、持久对话、停止、续写与编辑分支 | [Tavern](apps/tavern/README.md) · `apps/tavern` |

## 本地运行

在仓库根执行：

```sh
pnpm install --frozen-lockfile
pnpm dev          # 财务，5173
pnpm dev:blog     # 博客，5174
pnpm dev:zboard   # Zboard，5175
pnpm dev:tavern   # 酒馆，5176
pnpm dev:images   # 图床，5177
pnpm dev:ai       # AI，5178
```

Zboard/Tavern 的本地 Worker API 启动方式见各应用文档。根 `pnpm build`、`pnpm typecheck`、`pnpm test` 默认代理财务；其他应用用 `pnpm --filter <应用名> <脚本>`。

开发前从 [AGENTS](AGENTS.md) 选择应用；查设计、数据与验收规则从[文档导航](docs/README.md)进入。五个现有应用由 Cloudflare Workers Builds 自动发布；新增 AI Worker 的配置与发布顺序见 [AI 服务](docs/ai/README.md)，GitHub Actions 负责 PR 验收；本地检查和交付流程以[测试规范](docs/TESTING.md)为准。

## Codex 本地环境

配置位于 [.codex/environments/environment.toml](.codex/environments/environment.toml)。在 Codex 本地环境设置中选择 `Hasbai`。
新工作树自动检查 Node 24、固定 pnpm 版本，并安装 workspace 依赖。
现有工作区可运行 `node scripts/local-environment.mjs setup`。

快捷操作提供环境摘要、依赖安装、四应用启动和类型检查。
Zboard 与酒馆的 API 操作先构建，再启动本地 Worker。
两者共用 8787，须分别启动。
API 命令为 `node scripts/local-environment.mjs api <zboard|tavern>`。
类型检查不替代[提交前检查](docs/TESTING.md#运行)。

云环境的 Linux x86_64 开发使用 AMD64 镜像（日常开发在 Apple Silicon 上直接运行 pnpm，视觉检查用 `pnpm visual:*`）：

```sh
node scripts/cloud-dev.mjs run env CI=true pnpm install --frozen-lockfile
node scripts/cloud-dev.mjs run pnpm --filter blog typecheck
node scripts/cloud-dev.mjs run --publish 127.0.0.1:5174:5174 -- pnpm dev:blog --host 0.0.0.0
```

不传命令时进入 Bash。`run` 优先使用匹配当前 Dockerfile 的本地镜像，否则拉取固定 digest 的发布镜像。
修改镜像配方后，显式运行 `node scripts/cloud-dev.mjs build`。
本地构建镜像名为 `hasbai-cloud-dev:chromium-pw1.63.0-node24-pnpm10.33.2-amd64-v2`。

CI 与云环境共用 `docker/visual-ci/Dockerfile`，按架构发布两个镜像：
`linux/arm64` 是视觉 CI 和本地截图的默认镜像（`ubuntu-24.04-arm` 运行器、Apple Silicon 原生 Docker）；`linux/amd64` 仅供云环境，由 `cloud-dev.mjs` 引用。
两者各自按 digest 固定，不运行 ARM 或 AMD64 模拟；`cloud-dev.mjs` 在非 Linux x86_64 主机上拒绝运行。
镜像固定 Ubuntu Noble、Node 24.20.0、pnpm 10.33.2、Playwright 1.63.0 和 CJK 字体。
只安装 Chromium headless，最终文件系统合并为一层，以减少 `vfs` 的父层复制。
代理证书仅在构建及运行时挂载。

容器使用当前用户挂载仓库，文件修改会保留。
pnpm 缓存保存在忽略的 `.local-visual/cloud-dev-pnpm-store`。
完整 Playwright 与截图基线仍按[测试规范](docs/TESTING.md#运行)验收。

清理脚本只删除各应用的 `dist`、`dist-e2e`、`coverage` 和 `.svelte-kit`。
依赖缓存、凭据、本地数据库及测试和截图证据保留。
设置和清理脚本不复制凭据、不迁移数据库，也不启动服务或部署。

外部直接依赖在 `pnpm-workspace.yaml` 的 `catalog` 统一固定版本。
各应用和共享包使用 `catalog:` 引用；共享包的 peer 兼容范围保留。

Wrangler 固定 `4.148.0`，workerd override 固定 `1.20261009.1`。
此组合复用本机缓存；升级 Wrangler 时复核或撤销 override。
变更后须验证真实 Worker 启动和会话运行时。
安装使用 pnpm 全局内容缓存，不复制其他工作树的 `node_modules`。

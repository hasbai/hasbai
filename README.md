# Hasbai · 北极小站

个人使用的应用 monorepo，共享 Svelte 5、Luma UI 和北极小站登录。GitHub 仓库为 `hasbai/hasbai`，曾使用 `hasbai/financial` 名称。

| 应用 | 用途 | 代码与文档 |
| --- | --- | --- |
| 北极账本 | 资产负债、现金流、损益，流水补录、同笔退款与科目管理 | [Financial](docs/financial/README.md) · `apps/financial` |
| 北极小站 | 公开文章、手记、时间线、独立页面，在线 Markdown 编辑发布 | [Blog](docs/blog/README.md) · `apps/blog` |
| Zboard | 代理节点、用户资格、配置模板与订阅管理 | [Zboard](apps/zboard/README.md) · `apps/zboard` |
| 酒馆 | 角色卡与世界书、在线搜卡、持久对话、停止、续写与编辑分支 | [Tavern](apps/tavern/README.md) · `apps/tavern` |

## 本地运行

在仓库根执行：

```sh
pnpm install --frozen-lockfile
pnpm dev          # 财务，5173
pnpm dev:blog     # 博客，5174
pnpm dev:zboard   # Zboard，5175
pnpm dev:tavern   # 酒馆，5176
```

Zboard/Tavern 的本地 Worker API 启动方式见各应用文档。根 `pnpm build`、`pnpm typecheck`、`pnpm test` 默认代理财务；其他应用用 `pnpm --filter <应用名> <脚本>`。

开发前从 [AGENTS](AGENTS.md) 选择应用；查设计、数据与验收规则从[文档导航](docs/README.md)进入。四个应用均由 Cloudflare Workers Builds 自动发布，GitHub Actions 负责 PR 验收；本地检查和交付流程以[测试规范](docs/TESTING.md)为准。

## Codex 本地环境

配置位于 [.codex/environments/environment.toml](.codex/environments/environment.toml)。在 Codex 本地环境设置中选择 `Hasbai`。
新工作树自动检查 Node 24、固定 pnpm 版本，并安装 workspace 依赖。
现有工作区可运行 `node scripts/local-environment.mjs setup`。

快捷操作提供环境摘要、依赖安装、四应用启动和类型检查。
Zboard 与酒馆的 API 操作先构建，再启动本地 Worker。
两者共用 8787，须分别启动。
API 命令为 `node scripts/local-environment.mjs api <zboard|tavern>`。
类型检查不替代[提交前检查](docs/TESTING.md#运行)。

清理脚本只删除各应用的 `dist`、`dist-e2e`、`coverage` 和 `.svelte-kit`。
依赖缓存、凭据、本地数据库及测试和截图证据保留。
设置和清理脚本不复制凭据、不迁移数据库，也不启动服务或部署。

外部直接依赖在 `pnpm-workspace.yaml` 的 `catalog` 统一固定版本。
各应用和共享包使用 `catalog:` 引用；共享包的 peer 兼容范围保留。

Wrangler 固定 `4.148.0`，workerd override 固定 `1.20261009.1`。
此组合复用本机缓存；升级 Wrangler 时复核或撤销 override。
变更后须验证真实 Worker 启动和会话运行时。
安装使用 pnpm 全局内容缓存，不复制其他工作树的 `node_modules`。

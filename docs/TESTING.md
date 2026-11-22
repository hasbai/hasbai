# 测试与交付

财务及历史命令在 `apps/financial` 运行。根 `pnpm` 脚本默认代理财务。CI 由 `ci.yml` 按 `ci:*` 标签计划应用，并调用对应可复用 workflow。`packages/`、共享配置、共享脚本与 `.github/` 改动声明 `ci:all`。

## 运行

提交代码前，必须在本地完成受影响应用的全部非 Playwright 检查。检查失败时先修复，再开 PR 由 GitHub Actions 复验并执行完整 Playwright。修改前，在仓库根或容器内运行 `pnpm install --frozen-lockfile`。提交前统一运行 `git diff --check`。

| 应用目录 | 本地提交前检查（不含完整 Playwright） |
| --- | --- |
| `apps/financial` | `pnpm test:ci-tools`、`pnpm check:visual-coverage`、`pnpm typecheck`、`pnpm test:coverage`、`pnpm build` |
| `apps/blog` | `node ../financial/scripts/check-visual-coverage.mjs`、`pnpm typecheck`、`pnpm test`、`pnpm build`（含 workerd 启动检查） |
| `apps/zboard` | `pnpm check:visual-coverage`、`pnpm typecheck`、隔离本地 D1 迁移、带 `MIHOMO_BIN` 的 `pnpm test`、`pnpm build` |
| `apps/ai` | `pnpm check:visual-coverage`、`pnpm typecheck`、`pnpm test`、`pnpm test:runtime`、`pnpm build` |
| `apps/wechat` | `pnpm typecheck`、`pnpm test`、`pnpm test:runtime`、`pnpm build`（无页面与视觉检查） |
| `apps/images` | `pnpm check:visual-coverage`、`pnpm typecheck`、`pnpm test`、`pnpm build` |
| `apps/tavern` | `pnpm check:visual-coverage`、`pnpm typecheck`、隔离本地 D1 迁移、`pnpm test`、`pnpm test:session-runtime`、`pnpm build` |

- **容器与工具固定**：CI 与本地截图使用 `docker/visual-ci/Dockerfile` 固定的镜像。镜像包含 Ubuntu Noble、Node `24.20.0`、pnpm `10.33.2`、Playwright `1.63.0`（仅 Chromium headless）、CJK 字体与 Mihomo `v1.19.32`（`/usr/local/bin/mihomo`）。Apple Silicon 与视觉 CI（`.github/workflows/visual-image.yml`）使用 Linux ARM64 镜像。Linux x86_64 云环境统一使用 [AGENTS](../AGENTS.md#环境与运行) 中的 AMD64 `cloud-dev.mjs`，不得运行 QEMU 模拟。
- **隔离 D1 迁移**：每次新建临时目录，运行 `pnpm exec wrangler d1 migrations apply <zboard|tavern> --local --persist-to <临时目录>`。验证后清理该临时目录。不得写入生产或既有开发存储。
- **Workers Builds**：`main` 合并后由 Cloudflare Workers Builds 自动发布。GitHub Actions 不执行部署。

## 轻量任务与本地迭代

主代理在本地完成修改与全部非 Playwright 检查，不拆分子任务或多轮复核。源码与环境未变且检查已通过时，不重复执行。大计划、重复失败与长任务保留 architect 审查要求。

## 按需 PR 与自动合并

只有代码变更必须走 PR。纯文档、skills 及不影响前端输出的数据库或维护脚本改动见 [直推](#直推)。

- **声明 CI 范围**：由主代理运行 `gh pr create --label ci:<应用>` 手动声明 CI 范围。标签支持 `ci:financial`、`ci:blog`、`ci:zboard`、`ci:tavern`、`ci:images`、`ci:ai`、`ci:wechat` 或 `ci:all`（可传多个）。PR 描述必须写明跳过其余应用的理由。无 `ci:` 标签或手动 dispatch 默认运行全部应用。
- **必需状态与自动合并**：仓库保护唯一必需状态为 `Hasbai CI`（`ci.yml` 的 `gate` job 核对计划内 `success`、计划外 `skipped`）。非 Draft PR 打开、重开或转为 Ready 后，`automerge.yml` 启用 `gh pr merge --auto --squash`。修改 `.github/workflows/` 的 PR 受 `GITHUB_TOKEN` 权限限制，CI 通过后改用 `gh pr merge <PR> --squash`。暂停自动合并时，使用 Draft 或 `--disable-auto`。
- **PR 迭代与排查**：同功能修补与 CI 修复推至同一分支与 PR。合并后新修改另开 PR。检查状态时，只调用一次 `gh pr checks <PR>`，不得轮询。失败时只下载当前失败 job 日志与截图或 trace 一次并定位根因。无修改且无基础设施故障证据时，不得盲目重跑。
- **合并后**：核验 `main` 合并 SHA、Cloudflare 自动构建提交、部署结果与线上版本。不得重跑 `main` 全量 CI。

## 直推

纯文档、skills 及确认不影响前端输出的脚本改动可以直推。本地检查通过后，从最新 `origin/main` 快进推送。推送后必须核对远端 SHA（依赖管理员绕过 `main` 保护，保护配置变更后必须复核）：

```sh
git push origin HEAD:main
git ls-remote origin refs/heads/main
```

共享 UI、页面、测试门禁、`.github/`、API 契约、页面数据形状与共享配置必须走 PR。

## 视觉变更的提交前准备

修改 UI 后、提交前，必须在固定 Linux 镜像生成并审阅受影响截图。审阅项包含布局、留白、层级、对齐、桌面/移动/深色/短屏、聚焦与滚动边界。日常只维护 `linux-ci` 基线：

```sh
pnpm visual:local --page src/pages/Overview.svelte
# Blog: pnpm visual:blog --page src/routes/+page.svelte
# Zboard: pnpm visual:zboard --page src/pages/Overview.svelte
# Tavern: pnpm visual:tavern --all
# 局部预览（cloud-dev）：node scripts/cloud-dev.mjs run node scripts/visual-capture.mjs <应用> <场景ID>
pnpm visual:baseline:import-local apps/financial/.local-visual/<时间> --reviewed
```

- 修改共享组件、样式、夹具或 `packages/` 时，必须传 `--page` 或 `--all`。`import-local` 校验源码 digest 与 PNG SHA-256 后导入，不自动提交。
- 普通 CI 运行 `updateSnapshots: none`，不自动更新或重试掩盖抖动。有意视觉变化必须先在本地审阅、导入并提交基线，再开 PR。

## 页面覆盖清单门禁

各应用 `visual-coverage.json` 登记页面、URL 场景、状态、设备与测试标题。`check:visual-coverage` 校验页面无遗漏。全量 CI 设 `VISUAL_COVERAGE_GATE=1`，核对所列文件名的 `toHaveScreenshot` 实际执行与通过（仅 `page.screenshot`、跳过或删测试不计覆盖）。现有缺口必须写明豁免原因，修改对应页面时重新评估。

## 分层边界与浏览器范围

| 层 | 责任 | 不承担 |
| --- | --- | --- |
| Vitest 纯函数 | Decimal、金额合法性、日期半开边界、分录分配、原 ID、安全返回路径 | 浏览器布局 |
| Vitest 组件/API | 保存载荷、退款、冲突与不确定保存、筛选分页、会话缓存、HTTP 协议 | CSS 类、源码文本、第三方组件实现 |
| Playwright | 真实组件/CSS/路由、触控目标、焦点、截图差异（独立合成夹具） | 生产凭据、真实数据库、Auth0 契约 |
| 数据库脚本 | 三表边界、原子保存、权限、退款报表、余额历史连续性 | 固定个人账本行数 |
| JWT/API 脚本 | 本人真实登录、网关拒绝非法身份、生产读取与数值核对 | 像素布局、真机体验 |

所有浏览器检查只使用 Chromium（`iphone` 与 `iphone-se` 使用 Chrome 移动 UA，不代表 iOS Safari）。软键盘、PWA 安装、系统返回、安全区及真实代理或模型链路必须单独验收。不得用截图或构建成功替代上述验收。

## 数据迁移与发布核验

必要的隔离验证、生产迁移、真实 API 核验、提交与推送属于同一次已授权交付。Neon 迁移先在隔离分支验证，再应用生产（测试连接串从 stdin 传入，测试写入在事务回滚）。Zboard 与 Tavern D1 先在隔离资源验证。Tavern 另必须验证 [DO 与迁移一致性](tavern/AGENT.md#do与迁移一致性)。涉及新旧兼容的变更，先做兼容迁移，再自动部署，最后清理旧对象。

合并或直推后，必须核验远端 SHA、Cloudflare 自动 Build 提交、部署结果与线上版本（不手动重复部署）。未命中路径过滤时记录原因，不得声称应用版本已更新。自动化、真实 JWT/API、浏览器、真实上游与部署证据分别报告。

## 文档检查

纯文档改动只执行以下检查与 `git diff --check`，不重跑业务测试、构建或截图：

- 新入口可以到达相关规则。当前约束未因拆分或去重丢失。历史证据与当前规则分开。
- Markdown 与 HTML 本地链接及章节锚点可以解析。代码注释中的文档入口仍然有效。
- 命令、工作目录及 script 名称与 `package.json`、workflow 和维护脚本一致。
- 最终差异只包含任务文件，无凭据、私人内容或无关未跟踪文件。

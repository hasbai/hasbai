# 测试与交付

财务及历史命令在 `apps/financial` 运行。根 `pnpm` 脚本代理财务命令。

根 `ci.yml` 判断影响范围，再调用各应用的可复用 workflow；无关应用合法跳过，失败不得跳过。受影响范围由开 PR 的主代理用 `ci:*` 标签声明，共享代码（`packages/`、根 workspace 配置、lockfile、共享视觉脚本）须声明所有受影响应用或 `ci:all`。各应用的 `visual-coverage.json` 复用同一 manifest/execution gate。

## 运行

2026-10-09 用户要求：完整 Playwright 回归留在 CI。提交前必须在本地跑完受影响应用的全部非浏览器检查。检查包括类型、完整单测、已配置的覆盖率门槛、生产构建及 workflow 其他检查；失败先修复再提交。此规则取代旧的本地禁跑要求。CI 在最终 PR 上重复这些检查并执行完整 Playwright，不能用本地结果替代 PR 验收。

先在仓库根执行 `pnpm install --frozen-lockfile`，再按下表在对应应用目录运行现有命令。共享改动检查所有受影响应用；纯文档改动执行下文[文档检查](#文档检查)。提交前统一执行 `git diff --check`，不因只改一个组件而省略该应用完整单测。

| 应用目录 | 本地提交前检查（不含完整 Playwright） |
| --- | --- |
| `apps/financial` | `pnpm test:ci-tools`、`pnpm check:visual-coverage`、`pnpm typecheck`、`pnpm test:coverage`、`pnpm build` |
| `apps/blog` | `node ../financial/scripts/check-visual-coverage.mjs`、`pnpm typecheck`、`pnpm test`、`pnpm build`（包含真实 workerd Worker 启动检查） |
| `apps/zboard` | `pnpm check:visual-coverage`、`pnpm typecheck`、隔离本地 D1 迁移、带 `MIHOMO_BIN` 的 `pnpm test`、`pnpm build` |
| `apps/ai` | `pnpm check:visual-coverage`、`pnpm typecheck`、`pnpm test`、`pnpm test:runtime`、`pnpm build` |
| `apps/wechat` | `pnpm typecheck`、`pnpm test`、`pnpm test:runtime`、`pnpm build`（无页面，无视觉检查） |
| `apps/images` | `pnpm check:visual-coverage`、`pnpm typecheck`、`pnpm test`、`pnpm build` |
| `apps/tavern` | `pnpm check:visual-coverage`、`pnpm typecheck`、隔离本地 D1 迁移、`pnpm test`、`pnpm test:session-runtime`、`pnpm build` |

Mihomo 固定为 v1.19.32，SHA-256 在 `docker/visual-ci/Dockerfile` 中校验，镜像内路径 `/usr/local/bin/mihomo`，并预设 `MIHOMO_BIN`。`zboard-check` 在该镜像中运行，不再下载 Mihomo。

本地用 `node scripts/cloud-dev.mjs run` 的固定 Linux 镜像（已含 `MIHOMO_BIN`）；在其他环境未配置时原生用例会跳过，不能称为全部通过。Zboard/Tavern 的 D1 迁移用每次新建的临时目录，执行 `pnpm exec wrangler d1 migrations apply <zboard|tavern> --local --persist-to <临时目录>`，验证后清理；不写生产或既有开发存储。Tavern session-runtime 已自带隔离资源。

例如博客提交前在仓库根运行：

```sh
pnpm install --frozen-lockfile
pnpm --dir apps/blog exec node ../financial/scripts/check-visual-coverage.mjs
pnpm --filter blog typecheck
pnpm --filter blog test
pnpm --filter blog build
git diff --check
```

页面改动还须在本地固定 Linux 镜像生成并审阅受影响截图；`pnpm visual:local` 构建生产包和 e2e 包，仅运行所选 Financial 场景。完整 Playwright 套件与全部基线严格比较仍在 CI 执行。

视觉 CI 与本地截图统一使用 `docker/visual-ci/Dockerfile` 构建的 Linux AMD64 镜像。
镜像按 digest 固定 Chromium headless、Playwright 1.63.0、Node 24.20.0、pnpm 10.33.2 和 CJK 字体。镜像发布工作流是 `.github/workflows/visual-image.yml`；各应用的视觉 job 使用同一个 digest，单元任务仍运行在 Ubuntu。日常 `pnpm visual:local` 从相对 `origin/main` 的 Financial 页面改动选择清单场景；Blog、Zboard、Tavern 分别用 `pnpm visual:blog`、`pnpm visual:zboard`、`pnpm visual:tavern`，图床用 `pnpm visual:images`。

云环境与视觉 CI 统一使用 [AMD64 开发镜像](../README.md#codex-本地环境)，不使用 ARM 或 QEMU 模拟。
该镜像复用 CI 的 Dockerfile 与版本，适用于本地检查和服务启动。
镜像只安装 Chromium headless，并合并最终文件系统为一层。
日常 `run` 拉取固定发布镜像；修改配方后才显式 `build`。

需要局部预览时，可通过 `cloud-dev.mjs run` 执行 `node scripts/visual-capture.mjs <应用> <场景ID>`。
导入 CI 基线使用同一 AMD64 镜像，并遵循上述截图审阅与导入流程。

共享组件、样式、夹具或 `packages/` 改动须指定可重复的 `--page <源页面>` 或 `--all`。首次生成 Linux 基线运行 `--all`。审阅图在各应用忽略的 `.local-visual/<时间>/review/`；审阅后从仓库根运行 `pnpm visual:baseline:import-local <该次运行目录> --reviewed`，校验源码和 PNG 后导入本次截图。旧 macOS PNG 已清理；日常只维护 `linux-ci` 基线。

普通运行使用 `updateSnapshots: none`，缺少图片或超出差异即失败；PR 的 CI 不自动更新、不重试掩盖不稳定。远端候选截图模式已移除；审阅并导入本地 PNG 后，普通 PR 严格比较。

额外稳定性复跑只用于已复现抖动或明确排障，并记录原因。报告保留 expected/actual/diff 和失败 trace。有意设计变更须核对差异，不为消除差异提高容差或盲目更新。

各应用均沿用 Cloudflare Workers Builds 的 main 自动构建和路径过滤；GitHub Actions 只负责 PR 验收和自动合并，不部署。应用构建入口见[ARCHITECTURE](ARCHITECTURE.md#自动构建与运行入口)，交付时回读 Build SHA、部署结果和线上版本。

## 轻量任务与本地迭代

主代理在本地完成修改与检查，不拆分子任务或编排多轮复核。按上表完成受影响应用的全部非 Playwright 检查；失败先修复并复验，再提交、推送。不要依赖远端 CI 发现类型、单测或构建错误。源码或环境未变且检查已通过时，不重复执行同一检查；修复后重跑失败项及受修复影响的检查。大计划、重复错误及长任务的 architect 审查要求保留。

## 按需 PR 与自动合并

只有代码变更走 PR。纯文档、skills 及符合[直推](#直推)条件的维护改动，由主代理完成本地验证后直推 main，并核验远端 SHA。

**开 PR 前**：完成上述本地检查及受影响页审阅。需要新基线时，先在本地固定 Linux 镜像中生成、审阅并导入。

**声明 CI 范围**：由主代理创建 PR 并手动加标签，不派发布子代理，也没有路径推导脚本。每个 PR 都必须用 `gh pr create --label ci:<应用>` 声明（可多个）：`ci:financial`、`ci:blog`、`ci:zboard`、`ci:tavern`、`ci:images`、`ci:ai`、`ci:wechat`，或 `ci:all`。主代理按改动、调用方和共享契约判断范围：`packages/`、依赖文件、共享视觉脚本、`.github/` 的改动用 `ci:all`。没有任何 `ci:` 标签的 PR 和手动 dispatch 默认运行所有应用。PR 描述写明跳过其余应用的理由。

**必需状态**：只有 `Hasbai CI`。`.github/workflows/ci.yml` 的 `changes` job 读取 PR 的 `ci:` 标签并输出每个应用是否运行，再调用各应用的可复用 workflow（`financial.yml`、`blog.yml` 等）。`gate` job 核对：计划内应用必须 `success`，计划外必须 `skipped`；失败、取消或缺失都使门禁失败。同一 PR 的新运行取消旧运行，标签增删会重新触发。应用 workflow 的 job 名（`<应用>-check`、`<应用>-visual`）仍用于排查，不再单独设为必需状态。可复用 workflow 不设 `concurrency`，上传 artifact 须带应用前缀。

**自动合并**：非 Draft PR 打开、重开或转为 Ready 后，`automerge.yml` 执行 `gh pr merge --auto --squash`；`Hasbai CI` 通过后 GitHub 自动 squash 合并。该 workflow 用 `pull_request_target` 在 main 版本上运行，不检出 PR 代码。需要暂停时创建 Draft 或执行 `gh pr merge <PR> --disable-auto`。`GITHUB_TOKEN` 没有 `workflows` 权限，修改 `.github/workflows/` 的 PR 可能无法自动合并；CI 通过后改用 `gh pr merge <PR> --squash` 手动合并。

**PR 迭代**：同一功能的修补、评审修改和 CI 失败修复推到同一分支、同一 PR。自动合并在首次通过后即合并，合并后的修改另开 PR。

**PR 之后**：用应用的 PR 工具（`get_status`）或一次 `gh pr checks <PR>` 读取状态，不轮询、不循环 `gh run view`。CI 失败时只下载当前运行的失败 job 日志和对应截图/trace 一次，区分代码缺陷、测试假设、预期视觉变化与 runner/API 故障。未修改代码、基线或环境且无基础设施故障证据时，不盲目重跑；同一问题修复后仍失败，先重新判断根因。手动 dispatch 只用于明确排障。

**合并后**：核验 main 合并 SHA、Cloudflare 自动构建对应提交、部署结果与线上版本，不重复启动 main 全量 CI。PR CI 成功不代表真实 JWT、数据库或生产路由已验收。回报只需 PR、合并 SHA、CI 链接与结论、部署证据及实际未验收项；局部截图成功不得报告成完整 CI 通过。

**仓库设置**：个人账号仓库不能启用[合并队列](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)。`main` 保护要求 GitHub Actions 的 `Hasbai CI` 状态，`strict` 关闭，仓库只允许 squash 并启用 auto-merge。管理员可绕过保护（`enforce_admins` 关闭），这是直推的前提。分支保护用 GitHub API 维护；更改门禁名须同步 `ci.yml` 与保护设置。若迁到组织并启用合并队列，须同时加 `merge_group` 触发器、改必需状态，并改写 `automerge.yml` 的令牌。

## 直推

直推仅适用于纯文档、skills，以及确认不影响前端输出的数据库或维护脚本改动。相关本地检查通过后，从最新 `origin/main` 的任务分支快进推送，再核对远端 SHA：

```sh
git push origin HEAD:main
git ls-remote origin refs/heads/main
```

共享 UI、页面、测试门禁、`.github/` 的 CI 配置、API 契约、页面数据形状和共享配置走 PR。直推依赖管理员绕过 `main` 保护；保护配置变更后须重新核对，不绕过失败状态。

## 视觉变更的提交前准备

UI 修改提交前，必须打开实际页面并审阅截图。
检查布局、留白、层级、对齐和控件位置是否美观、合理。
操作受影响功能，检查桌面、移动端、深色和短屏状态。
输入或滚动变更还须检查聚焦、视口收缩与恢复、滚动边界。

发现问题先修复再提交；测试和构建通过不能替代视觉审阅。
交付时记录实际审阅范围、发现的问题和未验收项。

先判断是否改变页面视觉，列出影响的页面、状态和设备；更新对应应用的 `visual-coverage.json`，并在本地固定 Linux 镜像中运行受影响页截图。无意视觉变化时不更新 baseline，差异须先定位根因。需要更新时先审阅、导入并提交本地候选，再创建 PR；最终 PR 执行一次完整验收。分支 push 与合并后的 main push 均不触发测试。

```sh
pnpm visual:local --page src/pages/Overview.svelte
# Blog: pnpm visual:blog --page src/routes/+page.svelte
# Zboard: pnpm visual:zboard --page src/pages/Overview.svelte
# Tavern: pnpm visual:tavern --all
pnpm visual:baseline:import-local apps/financial/.local-visual/<时间> --reviewed
```

本地候选记录镜像、源码 digest 和各 PNG 的 SHA-256，代码变化后须重新生成。导入不会自动提交，最终 PR 仍须严格比较全部基线；不要关闭必需检查。

## 页面覆盖清单门禁

`visual-coverage.json` 是页面、URL 场景、状态、设备、测试标题与活跃 CI 截图的可检查清单。`check:visual-coverage` 比对真实页面文件；新增页面、清单遗留项、缺少证据或 baseline 会失败。本地初建基线时清单检查可暂缺 PNG，不能绕过清单与测试要求。Dashboard 另核对现有导航 registry 的动态视图；Financial 另核对 Shell 的 URL 分支，新 view/URL 不会因复用同一页面组件而漏掉。

全量 CI 设置 `VISUAL_COVERAGE_GATE=1`，reporter 再核对声明的测试确实在指定设备执行并通过；截图条目必须逐一实际执行清单所列文件名的 `toHaveScreenshot`，单纯 `page.screenshot`、跳过或删去测试不计作覆盖。`test-results/visual-coverage.json` 保留清单、豁免及结果。

该清单不是代码覆盖率，单个正常态不代表所有状态；已有缺口必须写明豁免原因，不计入已覆盖，修改相应页面时重新评估。常规有覆盖页面不需要新增重复测试。局部排障可不启用全量门禁，不替代 CI。

## 分层边界

| 层 | 责任 | 不承担 |
| --- | --- | --- |
| Vitest 纯函数 | Decimal、金额合法性、日期半开边界、分录分配、原 ID、安全返回路径 | 浏览器布局 |
| Vitest 组件/API | 保存载荷、退款、冲突/不确定保存、筛选与分页、会话缓存、HTTP 协议 | 每个 CSS 类、每句源码、第三方组件实现 |
| Playwright | 真实 Svelte/Shell/Repository、样式、路由、触控目标、焦点、截图差异 | 生产凭据、真实数据库、Auth0 登录契约 |
| 数据库脚本 | 三表边界、原子保存、权限、退款和报表、余额历史连续性 | 固定个人账本记录数 |
| JWT/API 脚本 | 本人真实登录、网关拒绝非法身份、生产读取与数值核对 | 像素布局、真机体验 |

## 浏览器与真实链路

各应用用真实组件与生产 CSS、独立合成数据入口执行 Chromium 回归，夹具与认证替身不进入生产构建。应用具体页面、状态和设备以 `visual-coverage.json` 及 Playwright 配置为准；财务的设备矩阵、覆盖率和 harness 见[财务测试契约](financial/TESTING.md)。

所有项目仅使用 Chromium，不再覆盖 WebKit、Firefox 或 Safari。
`iphone`、`iphone-se` 项目名保留原屏幕尺寸标签，使用 Chrome 移动端 UA。
这些项目只验证 Chromium 的视口、触控和布局，不代表 iOS Safari。实际软键盘、PWA 安装、系统返回、安全区和真实代理/模型链路须单独验收；不能用截图、HTTP 200 或构建成功替代真实 JWT、数据库权限及上游响应核验。

## 数据迁移与发布核验

必要的迁移、提交和推送属于已授权的同一次交付。Neon 迁移先在生产隔离分支验证，再应用生产并核验真实 API；不能用开发数据覆盖生产。Zboard/Tavern 的 D1 迁移先在隔离资源验证；Tavern 还须按[DO 一致性契约](tavern/AGENT.md#do与迁移一致性)验证旧来源、快照及删除。测试连接串从 stdin 传入，数据库脚本的测试写入在事务中回滚。

需要新旧客户端兼容的变更，先安排兼容迁移、再自动部署、最后清理旧对象；不只推前端遗漏数据库。生产迁移/API 验收后仅暂存任务文件并提交，涉及 API 契约或页面输出时仍走上述[按需 PR](#按需-pr-与自动合并)流程。

合并或允许直推后核验远端 SHA、Cloudflare 自动 Build 对应提交、部署结果及线上版本/资源，不手动重复部署。文档路径若被应用构建过滤命中，核验该次自动构建；没有触发应用构建时记录原因，不声称应用版本已更新。自动化、真实 JWT/API、浏览器、真实上游及部署证据分别报告。

## 文档检查

纯文档改动只执行文档一致性检查与 `git diff --check`，不重跑业务测试、构建或截图：

- 新入口能到达相关规则，当前约束未因拆分或去重丢失；历史要求与当前规则明确分开。
- Markdown/HTML 本地链接与章节锚点可解析，移动文档后代码中的文档入口仍有效。
- 命令、工作目录及 script 名称与 package.json、workflow 和维护脚本一致；配置事实与本地实现核对。
- 最终差异只含任务文件，无凭据、私人内容或无关未跟踪文件。若修改代码、配置、测试门禁或 API 契约，就按实际影响范围执行本地检查和 PR 流程。

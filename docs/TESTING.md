# 测试与交付

财务及历史命令在 `apps/financial` 运行。根 `pnpm` 脚本代理财务命令。根 `scripts/wait-ci.mjs` 位置不变。

四个应用各有独立 workflow，由 changes job 判断影响范围；无关应用的 job 合法跳过，失败不得跳过。受影响范围以 `scripts/affected.mjs` 为准，当前 `packages/`、根 workspace 配置及 lockfile 变更验证四个应用。各应用的 `visual-coverage.json` 复用同一 manifest/execution gate。

## 运行

2026-10-09 用户要求：完整 Playwright 回归留在 CI。提交前必须在本地跑完受影响应用的全部非浏览器检查。检查包括类型、完整单测、已配置的覆盖率门槛、生产构建及 workflow 其他检查；失败先修复再提交。此规则取代旧的本地禁跑要求。CI 在最终 PR 上重复这些检查并执行完整 Playwright，不能用本地结果替代 PR 验收。

先在仓库根执行 `pnpm install --frozen-lockfile`，再按下表在对应应用目录运行现有命令。共享改动按 `scripts/affected.mjs` 的范围检查所有受影响应用；纯文档改动执行下文[文档检查](#文档检查)。提交前统一执行 `git diff --check`，不因只改一个组件而省略该应用完整单测。

| 应用目录 | 本地提交前检查（不含完整 Playwright） |
| --- | --- |
| `apps/financial` | `pnpm test:ci-tools`、`pnpm check:visual-coverage`、`pnpm typecheck`、`pnpm test:coverage`、`pnpm build` |
| `apps/blog` | `node ../financial/scripts/check-visual-coverage.mjs`、`pnpm typecheck`、`pnpm test`、`pnpm build`（包含真实 workerd Worker 启动检查） |
| `apps/zboard` | `pnpm check:visual-coverage`、`pnpm typecheck`、隔离本地 D1 迁移、带 `MIHOMO_BIN` 的 `pnpm test`、`pnpm build` |
| `apps/tavern` | `pnpm check:visual-coverage`、`pnpm typecheck`、隔离本地 D1 迁移、`pnpm test`、`pnpm test:session-runtime`、`pnpm build` |

Zboard 的 `MIHOMO_BIN` 必须指向 Mihomo 二进制。版本须与 workflow 一致，SHA-256 须通过校验。

使用适配本机架构的发行包或固定 Linux 容器；未配置时原生用例会跳过，不能称为全部通过。Zboard/Tavern 的 D1 迁移用每次新建的临时目录，执行 `pnpm exec wrangler d1 migrations apply <zboard|tavern> --local --persist-to <临时目录>`，验证后清理；不写生产或既有开发存储。Tavern session-runtime 已自带隔离资源。

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

视觉 CI 与本地截图统一使用 `docker/visual-ci/Dockerfile` 构建的 Linux ARM64 镜像，并按镜像 digest 固定 Playwright 1.63.0、Node 24、pnpm 10.33.2 和 CJK 字体。镜像发布工作流是 `.github/workflows/visual-image.yml`；四个应用的视觉 job 使用同一个 digest，单元任务仍运行在 Ubuntu。日常 `pnpm visual:local` 从相对 `origin/main` 的 Financial 页面改动选择清单场景；Blog、Zboard、Tavern 分别用 `pnpm visual:blog`、`pnpm visual:zboard`、`pnpm visual:tavern`。

共享组件、样式、夹具或 `packages/` 改动须指定可重复的 `--page <源页面>` 或 `--all`。首次生成 Linux 基线运行 `--all`。审阅图在各应用忽略的 `.local-visual/<时间>/review/`；审阅后从仓库根运行 `pnpm visual:baseline:import-local <该次运行目录> --reviewed`，校验源码和 PNG 后导入本次截图。旧 macOS PNG 已清理；日常只维护 `linux-ci` 基线。

普通运行使用 `updateSnapshots: none`，缺少图片或超出差异即失败；PR 的 CI 不自动更新、不重试掩盖不稳定。远端候选截图模式已移除；审阅并导入本地 PNG 后，普通 PR 严格比较。

额外稳定性复跑只用于已复现抖动或明确排障，并记录原因。报告保留 expected/actual/diff 和失败 trace。有意设计变更须核对差异，不为消除差异提高容差或盲目更新。

四个应用均沿用 Cloudflare Workers Builds 的 main 自动构建和路径过滤；GitHub Actions 只负责 PR 验收，不部署。应用构建入口见[ARCHITECTURE](ARCHITECTURE.md#自动构建与运行入口)，交付时回读 Build SHA、部署结果和线上版本。

## 轻量任务与本地迭代

主代理在本地完成简单修复、文档调整和独立维护，不额外拆分子任务或编排多轮复核。按上表完成受影响应用的全部非 Playwright 检查；本地检查失败时先修复并复验，再提交、推送。不要依赖远端 CI 发现类型、单测或构建错误。源码或环境未变且检查已通过时，不重复执行同一检查；修复后重跑失败项及受修复影响的检查。

纯文档及其他符合现有直推边界的轻量改动，由主代理完成相关本地验证、提交、直推和远端 SHA 核验。需要 PR 的前端、共享 UI、API 契约改动仍先在本地完成修改与检查，再由发布子代理执行既有 PR/CI/合并流程；完整 Playwright 留在 CI，页面改动保留受影响截图审阅。大计划、重复错误及长任务的 architect 审查要求保留。

## 推送与合并

主代理编辑后，先完成上述本地检查及受影响页审阅，再提交；需要新基线时，先在本地固定 Linux 镜像中生成、审阅并导入。准备合并时才创建 PR，完整 CI 在 PR 上运行一次。失败由主代理修复后再派新子代理推送复核；后续 PR 提交或 main 前进仍会重新运行检查。

`check`、`visual`、`blog-check`、`blog-visual` 是既有保护要求的必需状态；Zboard/Tavern 改动还须分别通过 `zboard-check`/`zboard-visual`、`tavern-check`/`tavern-visual`。本地截图不能替代严格比较。合并后核验 main 合并 SHA、Cloudflare 自动部署和线上资源，不重复启动 main 全量 CI。

既有交付登记采用个人账号仓库的 PR 保护与 squash，未启用 merge queue。保护要求最新 main 与必要状态，故 PR 打开前先把功能分支与最新 main 对齐。仓库设置只允许 squash，合并使用 `gh pr merge --squash`。手动 dispatch 只用于明确排障。PR CI 成功不代表真实 JWT、数据库或生产路由已验收。[GitHub 合并队列说明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)

直推仅适用于独立且确认不影响前端输出的文档、数据库或维护脚本改动。相关本地检查通过后，可从最新 `origin/main` 的任务分支使用 `pnpm direct:push --validated --backend-reviewed --reviewed-path=<文件>` 快进推送 main；每个非文档文件各列一次，纯文档可省略参数。

脚本拒绝共享 UI、页面、测试门禁、CI 配置和混合路径，且核对远端提交。既有直推例外依赖维护者权限，按脚本和维护流程分类；远端保护配置变更后须重新核对，不绕过失败状态。API 契约、页面数据形状、共享配置仍走 PR。

若未来将仓库迁到组织并启用 merge queue，须同时迁移工作流的 `merge_group` 触发器、必需状态和等待脚本，不得只修改保护规则。

## CI 等待与收尾

需要 PR 的交付只由一个新子代理负责推送、PR/CI/合并和部署核验，主代理不并行查询同一运行；符合直推条件的轻量任务按上述本地迭代流程由主代理完成。派发时给出任务工作树、允许提交的文件、目标 SHA、PR 与所需验收阶段；CI 失败后返回具体失败证据，由主代理修改，再派新子代理。截图在本地审阅并导入后才创建普通 PR，不再使用远端候选运行。

发现当前运行 ID 后，用仓库内命令等待一次；SHA 使用 GitHub 该运行的完整 head SHA，event 必须符合所需阶段：

```sh
node scripts/wait-ci.mjs hasbai/hasbai <run-id> <full-run-head-sha> pull_request
```

命令先核对仓库、run ID、SHA、event；对进行中的运行只启动一个 `gh run watch --interval 30`，中间重复进度不进入代理上下文，结束后只读取一次终态证据。默认最多等待20分钟（可追加1–1800秒），两次元数据请求各限15秒；不启动或重跑CI。

退出0只表示该运行成功，1表示失败/取消/跳过/证据不匹配/API不可读，2表示仍待完成。返回2或API失败时保留运行链接和明确状态，不把未完成当通过，也不立即循环重开watch；只在新的状态证据或明确继续要求下恢复。

工具返回进程/执行cell仍在运行时，只续等同一进程；每次使用工具支持的较长等待，本地执行最多60秒。禁止每几秒调用`gh run view`/`gh pr checks`，禁止重启watch或把日志中的重复进度当成新证据。主代理仅等待子代理完成，不读取同一日志、不重复验收。

失败时只下载当前运行的失败job日志、对应截图/trace一次；区分代码缺陷、测试假设、预期视觉变化与runner/API故障。未修改代码/基线/环境且无临时基础设施故障证据时，不盲目重跑；同一问题修复后仍失败，应先重新判断根因。

停止条件：所需普通验收成功、PR合并已确认，以及本任务涉及的部署结果/版本已核对后立即回报并结束；不再额外跑测试、下载已成功的整套artifact或扩展至无关页面。CI/文档工具变更不追加业务登录或浏览器专项验收。回报只需PR、代码/合并SHA、各必要run链接与结论、部署证据及实际未验收项；局部截图成功不得报告成完整 CI 通过。

## 视觉变更的提交前准备

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

各应用用真实组件与生产 CSS、独立合成数据入口执行 WebKit/Chromium 回归，夹具与认证替身不进入生产构建。应用具体页面、状态和设备以 `visual-coverage.json` 及 Playwright 配置为准；财务的设备矩阵、覆盖率和 harness 见[财务测试契约](financial/TESTING.md)。

设备模拟不代表 iOS Safari 真机。实际软键盘、PWA 安装、系统返回、安全区和真实代理/模型链路须单独验收；不能用截图、HTTP 200 或构建成功替代真实 JWT、数据库权限及上游响应核验。

## 数据迁移与发布核验

必要的迁移、提交和推送属于已授权的同一次交付。Neon 迁移先在生产隔离分支验证，再应用生产并核验真实 API；不能用开发数据覆盖生产。Zboard/Tavern 的 D1 迁移先在隔离资源验证；Tavern 还须按[DO 一致性契约](tavern/AGENT.md#do与迁移一致性)验证旧来源、快照及删除。测试连接串从 stdin 传入，数据库脚本的测试写入在事务中回滚。

需要新旧客户端兼容的变更，先安排兼容迁移、再自动部署、最后清理旧对象；不只推前端遗漏数据库。生产迁移/API 验收后仅暂存任务文件并提交，涉及 API 契约或页面输出时仍走上述子代理 PR 流程。

合并或允许直推后核验远端 SHA、Cloudflare 自动 Build 对应提交、部署结果及线上版本/资源，不手动重复部署。文档路径若被应用构建过滤命中，核验该次自动构建；没有触发应用构建时记录原因，不声称应用版本已更新。自动化、真实 JWT/API、浏览器、真实上游及部署证据分别报告。

## 文档检查

纯文档改动只执行文档一致性检查与 `git diff --check`，不重跑业务测试、构建或截图：

- 新入口能到达相关规则，当前约束未因拆分或去重丢失；历史要求与当前规则明确分开。
- Markdown/HTML 本地链接与章节锚点可解析，移动文档后代码中的文档入口仍有效。
- 命令、工作目录及 script 名称与 package.json、workflow 和维护脚本一致；配置事实与本地实现核对。
- 最终差异只含任务文件，无凭据、私人内容或无关未跟踪文件。若修改代码、配置、测试门禁或 API 契约，就按实际影响范围执行本地检查和 PR 流程。

# 财务交付历史

> 历史记录：旧 home/RLS、禁止本地检查、远端候选等方案已被后续要求取代。当前契约见[财务入口](../README.md)，交付流程见[测试规范](../../TESTING.md)。

## 2026-09-20 移动端UI实查修复

- 已通过Chrome DevTools MCP检查生产移动页面与主要弹层，详细问题/方案/范围见UI-AUDIT.md。
- 修复手机损益图缩小、汇总错位、现金流入口留白。另修复筛选挤占正文和隐藏条件、日期下钻上下文、分录添加区冗长。另修复科目编辑短视口操作不可见及深色日期控件。
- 增补报表/筛选/拆分收入/科目短视口的CI视觉证据与交互断言；本地仅阅读、格式化和diff检查。候选run 35511755521的candidate-check及visual-baseline-candidates均成功，68张候选中43张为新增/变化；已复核并导入。普通PR严格比较、合并及Cloudflare自动部署以本次PR和运行记录为最终证据。
- 本次没有数据库迁移或生产数据修改。

## 2026-09-19 交易编辑页紧凑化（验收中）

- 已有交易标题改为当前交易名称，名称编辑时同步更新；删除原交易摘要卡及同商户历史科目建议，不再发起建议查询。
- 支出/收入/转账的展示文案改为“支出 / 收入 / 划转”；简单分录在单层卡片内按行直接展示，分类和账户选择按科目 ID 升序排列。
- 交易状态、支付渠道和支付流水号不再从“交易来源”展开，改为与对方、时间、备注一致的常驻紧凑字段行；同时收紧页面、卡片、头部和底部间距，保留 48px 触控高度、焦点归还和原分录 ID。
- 本地按规范不运行测试、typecheck、build 或 Playwright。首轮候选检出旧滚动断言仍以备注为目标，改为验证新增的支付流水号。随后候选 run 35427913603 的 check 与 43 项浏览器场景通过；已核对并导入手机、窄屏、深色、缩小视口与桌面编辑器候选。普通 PR 严格比较、合并与自动部署结果待交付流程核验。
- 本次没有数据库、API 或业务数据变更。

## 2026-09-16 生产弹层定位与手机滚动条

- 用户反馈已安装iOS PWA仍裁切。线上资源与上轮main产物一致；定位到生产CSS压缩删除translate:none，但桌面负半宽/半高translate仍作用于手机。底部transform动画不抵消individual translate，导致移动弹层左上裁切。
- 先只改CI加载实际生产CSS。run 35115492795复现15项移动边界断言失败，21项通过。证实上一轮开发服务视觉测试遗漏生产压缩差异。正式修复将桌面定位/translate限制在sm断点，手机无须reset。
- 手机统一隐藏页面与弹层滚动条，保留原生滚动；增加滚动仍可达及生产CSS入口断言。所有测试继续只在GitHubCI执行，本地只编辑/提交；验证与发布结果见交付记录，未做iOS真机验收。

## 2026-09-16 CI集中验收与子代理交付

- 按最新要求，本地不再运行单元/覆盖率/浏览器测试及整套typecheck/build验收；主代理编辑提交后，必须派新子代理推送功能分支、创建/更新PR。核验最新提交的check/visual，成功且同步main后才能合并。合并后仍核验自动部署和线上版本。流程写入AGENTS、TESTING与ARCHITECTURE。
- Check保持每次push/PR执行Ubuntu单元覆盖率/类型/构建和macOS浏览器回归；新增只读contents权限、同分支同事件旧运行取消和check超时。普通CI不更新视觉基线。
- 私有仓库保护接口最初因套餐返回403；随后用户明确授权将仓库公开。公开前检查当前文件与Git历史，未发现凭据/私钥/真实账本导出。仓库已设为public并启用main保护：强制PR、check/visual必需且跟上main、管理员不可绕过、不可force push/删除；单人开发无需额外人工审批。没有购买套餐。
- 手机弹层修复的CI候选基线run 35108709974：Ubuntu检查成功；macOS显式更新36/36、无更新复跑36/36，46张CI截图；候选已取回，后续普通push/PR验证及发布结果见交付记录。

## 2026-09-16 手机弹层与字号修复

- 手机分类/账户/分录/筛选、退款和科目编辑统一底部弹层；使用独立VisualViewport容器贴底，内部滚动与安全区限高，240ms滑入/160ms滑出并尊重减少动态效果。打开时不自动唤起输入键盘，选择关闭归还焦点。
- 修复unlayered全局h1覆盖Tailwind字号：编辑标题18px、普通移动页标题24px、总额24px、待填写16px；输入保持16px，搜索触控高度48px。
- 原固定fixture视口未复现用户实际设备越界；旧分类截图通过不能证明新增付款账户、键盘/视口变化可用。新增边界/触控/长列表/缩小与横屏/嵌套选择/动画回归，实际检出搜索36px及WebKit选择后焦点丢失并修复，审计见TESTING。
- 本机36/36 Playwright、46截图场景（新增12），显式更新基线后普通比较全通过；91/91单测，行84.38%、分支76.59%、函数80.81%；typecheck、build、diff-check通过。没有数据库或API协议改动，未做iOS真机验收。CI及生产结果见交付记录。

## 2026-09-16 测试审计与移动端视觉自动化

- 新增 Vitest v8 覆盖报告与门槛，逐文件审计见 [TESTING](../../TESTING.md)。96 项清理为 91 项，保留金额/日期/退款/权限/缓存协议；移除源码黑名单、旧字段探针与固定账本数量。核心API读对象与保存载荷使用正向协议断言。
- 新增原生 Playwright：iPhone 13、iPhone SE / WebKit 优先，辅以 Android 和桌面 Chromium；25 项、34 个截图场景（本机与CI分别保存基线）覆盖主要页面状态、隐私/深色/窄屏、键盘与触控。连续三轮 75/75 通过；故意 12px 错位使截图比较失败（21,390 像素差异），原测试随后恢复。无需 Docker，日常回归不依赖逐页人工或 AI 看图。
- 浏览器实测发现缩小视口后备注焦点留在屏幕外；EditorSurface 通过 ResizeObserver 在实际滚动区布局完成后保持焦点可见。并非真机软键盘验收。
- typecheck 0错误/警告；91 项 Vitest、build、git diff --check通过。行覆盖84.94%、分支77.04%、函数81.21%；相对旧基线下降主要因为外壳/导航/移动布局迁到Playwright，未将其排除覆盖率分母。
- 隔离 Neon 分支 br-divine-frost-b3dv0o2s 数据库47+41项通过，写入全回滚；真实本人JWT生产API与首页核对通过。本次没有数据库迁移或业务数据修改。
- CI新增macOS 26原生浏览器任务、覆盖率/截图/trace工件；缺少或偏离基线即失败，CI不自动更新图片。生产构建不含测试入口或fixture token。首次推送单元/构建与Cloudflare自动部署成功，线上32文件哈希一致；视觉CI检出环境字体栅格化差异，现独立保存runner基线，显式生成后25/25正常比较通过。最终提交的push检查结果见本次最终消息。

2026-09-15 更新。006角色授权迁移已应用生产，真实JWT/API及首页核对通过；代码5adabe3已由Cloudflare自动部署。

## 2026-09-16 PWA 刷新仍停留旧版

- 重新核验生产b5a1495、Cloudflare版本bb67ead5-d323-4629-9eaf-a16eeaa93cd2、31项预缓存文件及sw.js均与dist一致。用户仍见旧页面的更新路径缺陷在SW：旧导航cache-first，新SW保持waiting，普通刷新期间旧client与新导航重叠。不能保证激活新版。此前只验证线上资源未覆盖已安装PWA更新链路。
- 新版完整预缓存成功后skipWaiting并claim；导航no-store读取规范/，失败回退完整安装版本，不缓存回调或参数。无自动reload/Client.navigate，保留旧窗口可能使用的哈希资源；仅无打开窗口时清理旧版缓存。启动/前台/恢复网络事件检查更新并合并在途请求。
- 生命周期回归覆盖旧窗口存在时完成更新、下一次导航取线上新版和旧chunk离线读取。另验证不导航现有表单、失败安装不接管、离线/503回退及无窗口清理边界。沿用API/认证请求排除与真实HTTP307回归。
- pnpm typecheck 0错误/0警告，pnpm test 14文件96项、pnpm build、git diff --check全部通过。日志/tmp/financial-pwa-update-validation/；上线结果见交付记录；诊断证据/tmp/financial-pwa-diagnosis/。没有数据库变更、未使用浏览器，不能声称已检查用户iPhone上的实际控制器或真机更新结果。

## 2026-09-15 手机交易页面与导航

- 右下角圆形入口仅显示加号，保留“记一笔”无障碍名称。移动导航改为总览/流水/设置，设置页通过科目入口进入科目设置，保留/accounts地址并提供返回设置。
- 手机新增、流水详情及其加载/错误状态改为独立路由页面，不挂载流水背景或主Dialog；桌面保留居中Dialog。编辑页顶部返回、底部保存和单一正文滚动区适配VisualViewport与安全区，手机隐藏应用菜单/底栏；原未保存、退款、保存冲突和科目选择逻辑保留。编辑中仍按既有约定显示金额，退出沿用全局隐藏偏好。
- 总资产和总负债进入资产负债标签并分别选中资产/负债，仅展示对应汇总和科目余额；可切换全部。标签、筛选和月份保存在URL，支持直接打开及返回。移除每日余额详情列表及其面板查询，保留净资产趋势。
- pnpm test 13文件94项通过，pnpm build、git diff --check通过；覆盖新增/详情路由、加载/失败/重试、桌面Escape未保存保护、资产负债筛选/金额隐藏、设置往返。pnpm typecheck 0错误/0警告；最终复验94项测试、git diff --check通过。日志 /tmp/financial-navigation-validation/ 与 /tmp/financial-navigation-final/；线上版本核验见本轮交付记录。
- 本次没有数据库或API协议变更，不需要迁移；未使用浏览器，未进行iPhone真机视觉和触控验收。提交推送后由Cloudflare自动部署，不重复手动发布。

## 2026-09-15 PWA 首页重定向故障修复

- 用户报告首页 FetchEvent network error。已真实HTTP复现：/index.html 返回307到/，默认fetch跟随后Response.redirected=true；旧SW的cache.addAll缓存该响应，导航redirect=manual时浏览器拒绝。此前HTTP200和资源哈希核验未覆盖此响应语义，不能代表SW控制下导航可用。
- 缓存入口改为规范根路径/，导航缓存响应若redirected则重建Response。新版install阶段原位修复旧financial-static缓存的/index.html，保留旧应用正文和版本，以使旧worker在新版waiting期间恢复导航；不skipWaiting、不强制刷新或丢弃表单。
- 增加真实本地HTTP307回归，覆盖首页、新建交易、带code/state的回调导航redirect=manual、旧缓存原位修复及无关缓存保留。pnpm typecheck 0错误/0警告；pnpm test 13文件90项通过；pnpm build、git diff --check通过。真实生产HTTP根因复现通过，未使用浏览器。

## 2026-09-15 iOS 优先录入与 PWA

- 收入/支出分类按当前类型过滤，不渲染无关五类标题；分类和账户均按type/subtype分组后选择name，支持范围内搜索、重开定位、返回大类及选择后焦点归还。手机全屏选择，桌面居中面板。
- 新增收入/支出/转账业务分录编辑，支持拆分分类、多账户分配、工资扣税；唯一目标账户主动编辑时自动计算余款，差额未平禁用保存。已有工资多分录可恢复业务表单，复杂/退款/不平衡历史仍完整编辑。保留原entry ID、updated_at冲突、未保存提醒、结果不明禁止重复保存。
- 修复金额schema空字符串Decimal异常、零分录旧记录打开即被改动、高级编辑100条上限及科目加载失败时保存门控。零分录旧记录需点击开始补录才创建输入行。
- 统一页面横向约束、图表边界、弹层单滚动区、顶部和横屏安全区；VisualViewport处理iOS键盘高度/偏移，保留系统缩放。断网状态禁用交易保存并保留内存输入。
- PWA manifest、standalone、Apple Touch Icon、180/192/512图标与版本化Service Worker已实现。仅预缓存公开静态资源；API/认证/账本/令牌不缓存，不做离线写入。新SW等待旧客户端关闭，不强制刷新编辑中的页面。
- 自动化：pnpm typecheck 0错误/0警告；pnpm test 13文件89项通过；pnpm build和git diff --check通过。覆盖工资扣税精确金额/ID、多账户差额、多分类、转账和焦点恢复。另检查离线恢复、零分录、加载失败、PWA请求排除/版本及键盘viewport。
- 真实生产JWT/API检查通过（86科目、流水/分页/筛选/十进制报表及非法保存/认证拒绝）。本次无数据库迁移，不添加真实测试交易。日志 /tmp/financial-ios-final/ 与 /tmp/financial-ios-acceptance/；最后89项全部通过结果见本轮交付记录。
- 未使用浏览器，未进行iPhone真机安装、独立窗口登录、实际滑动/键盘与视觉验收。提交推送与Cloudflare自动部署结果见本轮交付。

## 2026-09-15 首页源数据复用

- 定位三轮六源GET重复：home查询30秒即陈旧，切页重新挂载后整体重取；Repository仅在途Promise合并，完成即删除；现金科目ID与全量科目列表独立；显示金额从隐藏投影切换会重复读取五项已有源数据。
- 源行与页面共用同一QueryClient，报表及截止时点在同一会话内复用，跨北京时间日期重新进入时刷新；保存交易失效报表和交易，保存科目全量失效，刷新页面重新读取，退出清空。所有缓存仅在内存。
- account改为一次完整有序分页读取并供各页面复用；balance/income/history用于首页与明细共同计算；cashflow优先裁剪已读取的覆盖区间，保留微秒半开边界和Decimal金额计算。失败重试只重读失败源。
- 自动化：pnpm typecheck 0错误/0警告、pnpm test 10文件76项、pnpm build、git diff --check均通过。覆盖20分钟导航/聚焦/重连复用、跨日刷新、保存失效、退出清缓存、隐藏转显示及失败源重试。
- 生产真实JWT/API验证通过：86科目、流水/筛选/游标、十进制报表、非法保存及错误认证拒绝；首页冷读6类源GET（本次2588ms），随后首页/科目/资产/损益/现金明细新增0 GET。以独立Repository重新取数核对全部首页指标一致。
- 此次不涉及数据库迁移；未做浏览器视觉验收。验收日志：/tmp/financial-cache-acceptance/。提交推送及Cloudflare自动部署核验见本次交付结果。

## 2026-09-15 生产迁移与自动部署验收

- 已补齐生产006_role_access.sql，单事务提交于北京时间13:16—13:18之间。account/transaction/entry分别86/548/1012行，字段、ID和内容指纹前后一致；balance、balance_history、cashflow定义不变。
- 多余读取函数和页面包装视图已删除，superadmin角色及GRANT生效；三表RLS关闭，应用和SQL不再重复检查JWT身份。生产Data API原本即为.role，无需变更provider或schemas。
- 生产check-api和check-home-api均通过：真实PKCE登录、原报表直读、十进制字符串、游标/筛选、非法保存、错误签名/audience/无token拒绝；首页6次源GET与完整报表一致。
- 上轮main提交5adabe386469101f4bf6efaf242e0d069766d219已自动部署成功：Cloudflare版本a9e70a58-e227-429c-a77d-c6a86303b7ce，生产流量100%。线上index及22个assets文件与对应本地构建SHA-256逐一一致，GitHub Check成功。未手动重复部署，未做浏览器视觉验收。
- 用户明确后续迁移、提交、推送一并交付，main推送自动部署；已写入AGENTS及架构文档。先隔离验证、生产迁移/API验收，再提交推送并核验自动部署。
- 数据库/API证据：/tmp/financial-production-role-access-evidence.json、/tmp/financial-production-check-api.log、/tmp/financial-production-check-home-api.log。

## 2026-09-15 取消权限函数和页面包装视图

- 按用户最新要求，以 Auth0 superadmin 和 PostgreSQL schema/对象 GRANT 授权；删除 is_owner、personal_* policies，关闭三表 RLS。保留保存业务校验、分录 ID、原子提交和余额刷新。
- 006_role_access.sql 删除 home、balance_read、balance_history_read、cashflow_read、cashflow_daily 及对应读取函数、旧查询 RPC。原 balance/cashflow/balance_history 定义和三表记录/ID不变。既有 transactions、statement_entries、income_statement 业务视图继续使用。
- 前端直接读取报表列，Decimal 完成金额汇总、分类、日统计和首页数据形状，取消后端 home 快照依赖。保留现有页面和按需请求；隐藏金额时不读取余额历史。
- 隔离分支 financial-role-access-20260915 / br-divine-frost-b3dv0o2s 已应用迁移，原三表86/548/1012行及内容指纹、字段均未改变。角色读写、普通角色拒绝、业务校验与刷新通过；测试数据回滚。
- Auth0 financial role Action（35884b07-e1f4-4ab8-b66c-0325d5a055e4）已部署版本2，沿用原post-login绑定，只对financial API写入顶层 role=superadmin。其他Action和绑定保留。命名空间claim在Neon未正确选择角色，顶层role配合.role已通过真实PKCE/API验收。
- 隔离API ep-rapid-union-b3ncctmg 的 check-api/check-home-api 已通过：原报表直读、首页与完整报表一致、签名/audience/无token拒绝。生产Neon未改；前端尚未部署，未做浏览器视觉验收。
- 最终验收：pnpm typecheck 0错误/0警告，pnpm test 10文件72项、pnpm build、git diff --check 全通过；更新后的数据库脚本47项、余额历史41项通过。日志 /tmp/financial-role-acceptance/。
- 当前授权边界和数据转换职责已同步 AGENTS、DATABASE、ARCHITECTURE 和 DOMAIN，以下各条为历史过程记录，旧 is_owner / home 方案不再是当前目标。

## 2026-09-15 Balance 与每日历史统计

- 接入用户现有 balance 物化视图及 cashflow，停止查询已删除的 balance_sheet/cashflow_statement。保留 balance 原定义；新 balance_history 沿用同笔科目齐全规则，按北京时间每日累计并补齐无交易日，只计算至维护当天。用户更新后的 cashflow 排除零净额转账，测试已适配。
- 新增005迁移及 refresh-balances 维护脚本。save_transaction/save_account 在整笔保存结束后全量刷新两个MV；批量直接维护后可一次性手动刷新。不创建定时任务、基表字段或触发器。物化视图本体不对客户端授权，固定search_path身份保护函数加security_invoker包装视图保留本人sub/issuer/audience隔离。
- 首页仅统计，移除最近逐笔交易；现金默认所选月份，保留未来30天。现金/余额/损益面板提供逐日下钻；现金日内首尾裁剪保持与统计一致，余额下钻使用已匹配科目范围。金额隐藏同时隐藏图表和日表，当前首页仍单GET。
- 生产副本最终验证分支：financial-balance-validation-final-20260915 / br-wandering-cloud-b3czr9xh。数据库基础37项、余额历史46项、首页8项全部通过；真实Auth0 PKCE JWT check-api/check-home-api通过。全部数据库测试写入回滚。
- pnpm typecheck、pnpm test（10文件71项）、pnpm build、git diff --check通过。包含当前MV/历史日末读取、精确现金边界、每日下钻、隐藏金额、按需请求、失败重试。深浅色、窄屏布局和键盘入口按源码及DOM复核，未做浏览器/真机视觉验收。
- 生产005已单事务应用。balance_history共4750行、50科目、2026-06-13至2026-09-15共95日，每科目无日期缺口；当次最新历史与balance逐科目一致。原表行数和内容指纹不变：account 86/70412c04ef6e1aa2e97c0625fba82c2a，transaction 548/31b7950045bf92edb7ce1e97e0025b6f，entry 1012/e2a847d710d8664497e39b4cf8eaf17d。未复制开发数据覆盖生产。
- **生产API未通过稳定验收**：check-api曾完整通过，check-home-api和原始请求反复出现PGRST205（home/balance_read/cashflow_read）。已确认Vite和实际请求均使用生产endpoint ep-long-dew-b3q1him6；SQL NOTIFY及Data API db_schemas原值重新提交仍未恢复稳定。原公开配置、身份及schema集合未改变；错误audience依然无法读业务数据。不可将一次成功请求当作全部接口稳定可用。
- **未发布Worker**。待生产Neon Data API缓存问题消除后，重新运行生产check-home-api，再按发布授权部署前端。未重启共享数据库、删除分支或修改Auth0配置。
- 原始验证证据：/tmp/financial-front-validation/accepted-*.log、/tmp/financial-balance-validation-final-20260915/results.log、/tmp/financial-production-balance-20260915/precheck.txt。

## 2026-09-14 首页合并为一次业务请求

- 上轮只去除了重复URL和未打开明细的预加载。图表点与卡片仍拆成11次HTTP请求，未解决首屏请求总量问题。本轮新增 `004_home_snapshot.sql` 的 `financial.home` 只读视图，一次GET返回当月首屏余额/损益、待补录数及现金配置状态。另返回6个净资产曲线点、未来30天现金合计/5个分组、最近3笔卡片字段和分类。
- 不再为首页读整张科目表、额外交易页或逐个曲线点。SQL完成金额和分组，未将多个外部HTTP隐藏到代理后端；保留原三表/字段/记录/ID和现有JWT/RLS。历史月份和主动打开的明细继续使用原视图按需查询，首页视图缺失时明确报错，不回退11次请求。
- 隔离分支 `financial-home-snapshot-20260914` / `br-winter-pine-b3lvdtba`（production的副本）已执行004迁移。`scripts/test-home-database.mjs` 8组场景通过：完整报表对照、6个曲线点、现金起止/6日分组边界、最近交易/分类。另验证非法subject/issuer/audience/空claims隔离及测试前后三表行内容不变。原 `scripts/test-database.mjs` 35项通过，所有测试数据回滚。
- `scripts/check-home-api.mjs` 在隔离Data API、真实本人Universal Login + PKCE下通过：首页恰好1次GET，响应910字节，单次样本5671ms；余额/损益/待补录与完整报表一致，隐藏投影不返回图表列。这是网络和数据库合计的单次观测，不代表延迟分位或性能提升结论。
- 子代理独立核验发现“隐藏→显示”瞬间会抢先发出10次旧图表请求；已通过快照状态门控修复并加入真实组件→Repository→fetch计数回归。初次首页和保存刷新均仅1次业务GET；初次隐藏不读图表列，首次显示补1次完整快照，再隐藏不请求；明细仍懒加载。
- Auth0 `/oauth/token` 是现有内存token模式下首次换码/恢复登录所需，SDK缓存避免逐笔业务请求重新换码。`/cdn-cgi/rum` 为非必需的Cloudflare性能上报；源码没有手写beacon，子代理获取的生产HTML当时也未注入beacon，不能仅凭请求清单推断控制台当前开关。本轮未改Auth0或Cloudflare Analytics配置。
- 未执行生产迁移、Worker部署或浏览器视觉验收。发布前必须先应用004迁移并验证生产API，再发布前端；两者不能只发前端。最终 `pnpm typecheck` 0错误/0警告，`pnpm test` 10文件69项，`pnpm build` 和 `git diff --check` 均通过。

## 2026-09-14 页面按需加载与请求去重

- 用户请求记录包含19次业务 GET：全量 overview 扇出10次、科目1次、最近流水1次、净资产曲线6次、未来现金合计1次。其中科目余额、损益分类/趋势、月度现金合计/分类、期初现金与期间质量均在默认首页提前加载；曲线期末余额与主卡完全重复。Auth0换令牌与Cloudflare RUM分别只有1次，不是本轮重复业务请求来源。
- 报表按片段独立缓存并由当前页面/面板启用；默认未来现金模式不加载本月现金合计。净资产曲线复用期末余额，另外五个历史时点及现金图表分组按区间缓存。最近交易按3条分页读取（加1条游标探测），不再取整页30条。直接打开交易编辑页不会请求背后流水列表或月报。
- 30秒内快速导航共享截止时点、科目与报表缓存；保存后的既有失效范围继续生效，隐藏图表不发起请求。现金期间选择在切换报表月份/面板后保持。
- 新增真实组件到 Repository/fetch 边界的请求计数回归：无未来现金流的可见金额首页11次，URL全部唯一。隐藏金额首页6次；资产面板首次补1次、损益面板首次补2次，返回新鲜缓存不重查；流水首次5次，编辑背景0次。另覆盖跨页共享、保存失效、惰性明细失败及只重试失败查询、月份切换。
- 真实本人 Auth0 Universal Login + PKCE 与生产 Repository 只读验收通过。首页基础数据和净资产历史时点共11次唯一 GET、科目86条、最近交易3条。三个明细片段共3次 GET；余额/损益/待补录及明细与完整报表逐项一致。令牌仅在内存，未改认证配置。
- 本次无数据库迁移或数据写入；未执行浏览器/真机视觉验收，未部署 Worker。`pnpm typecheck`（0错误/0警告）、`pnpm test`（10文件66项）、`pnpm build`、`git diff --check` 均通过。

## 2026-09-14 生产迁移与正常登录验收

- 已将 `003_read_views.sql` 应用于 production 分支 `br-billowing-violet-b3pkbm3s`。此次为直接执行已在隔离分支验证的版本化 SQL，没有将开发分支数据覆盖到生产。
- 迁移前后三表行数和内容校验值一致：account 86行（`dd1f9ed030c40ef67fa82d5e5085e68f`）、transaction 548行（`6d63df4a38b4a60a09e738b4aa2e83c7`）、entry 1012行（`f1ad3db01c75a5989d7e17f02f3474fe`）。新旧六个视图均设置 `security_invoker=true`。
- Cloudflare 当前版本 `3ca89689-0b73-4fcb-8c9a-84fa5d98af5c`（2026-09-14T02:17:50Z）已对应本地前端。本轮读取部署列表并核对首页和24个部署文件均与 `dist` 逐字节一致，因此未重复部署。首页 SHA-256 为 `aee403daec40847eda4aa9884b678fd93efd3948d6d9abb95308b6966332912c`。
- 首页、流水、交易详情、新增和科目深链接均200；API CORS预检200并允许前端所需头，无token请求400。所有检查通过HTTP完成，未使用浏览器。
- 再次完成 `pnpm typecheck`（0错误/0警告）、`pnpm test`（9文件59项）、`pnpm build`、`git diff --check`；构建秘密扫描未发现 `.env` 中的两个凭据值。
- 已实测 `.env` 本人账号经正常 Universal Login 账号页、密码页、授权码回调和 PKCE 换取 Access Token（200）；sub/iss/aud匹配。未调用管理 CLI、未修改 Auth0 grant 或其他配置。
- 使用真实 token 调用实际前端 Repository：科目86条、流水分页/详情、资产负债汇总、现金流汇总、完整总览均通过；新视图的 SQL 聚合和十进制字符串协议已在生产实际执行。
- 真实 API 新旧口径对照通过：本月、空历史期间、未来30天的11个金额指标、质量计数及分组数量一致；待补录、待匹配、现金完整交易、科目ID、科目类型、特殊字符搜索、退款状态七组流水筛选结果一致。
- 已将 `scripts/auth0-token.mjs` 改为可复用正常登录流程，并实际执行 `pnpm check:api` 通过：本人科目读取、流水视图/游标/筛选及三类报表通过。非法写入、伪造签名/错误audience/无token拒绝均通过；脚本不修改Auth0配置，不输出凭据或token。
- 上次未完成登录的具体原因是测试脚本依赖 Auth0 CLI 管理会话，并试图临时切换 password grant；不能据此推断 `.env` 本人用户名密码失效。本轮按用户要求改为正常 Authorization Code + PKCE 登录验证。

## 2026-09-14 四类查询视图

- 新增迁移 `003_read_views.sql`：`balance_sheet`、`income_statement`、`cashflow_statement` 三个 security_invoker 视图，扩展已有 `transactions` 视图的筛选/质量计算列。未新增或修改基表字段、原记录或 ID。
- 前端流水列表、详情及报表全部改为 GET 视图；金额聚合通过 Data API 在 PostgreSQL 内进行，输出十进制字符串。RPC 仅用于 `save_transaction`、`save_account`。旧查询函数暂留兼容线上版本及数据库回归对照。
- 流水保留全部筛选与时间戳/ID游标分页；分组结果超过1000行继续读取。现金流图和净资产曲线分别只取所需现金/余额合计。页面结构、文案、金额隐藏及查询失效入口沿用原实现。
- 生产副本隔离分支 `financial-report-views-20260914` / `br-sweet-sky-b3qgf4h2` 已执行迁移。`scripts/test-database.mjs` 35项通过，覆盖新旧报表对照、空期/历史/日内半开边界、现金勾稽及同笔退款。另检查原子保存、四类视图权限和非法身份隔离；测试写入均回滚。
- 隔离分支与生产三表行数/行内容校验值一致：account 86行、transaction 548行、entry 1012行。
- `pnpm test` 9文件59项通过；包括只读 GET 契约、筛选/游标精度、SQL金额字符串、空聚合、超过1000行的报表分组及单查询失败处理。`pnpm typecheck`（0错误/0警告）、`pnpm build`、`git diff --check` 通过。
- **未完成真实 JWT/API 验收**：Auth0 CLI 登录已过期，程序化 token 获取被 `unauthorized_client` 拒绝；未变更 Auth0 配置。`scripts/check-api.mjs` 已增加四类视图、聚合转换、筛选、分页及错误 audience 检查，待登录恢复后执行。
- **未执行生产迁移、Worker部署或浏览器/真机验收。** 发布新客户端前先执行生产迁移并完成真实 API 验收；本次隔离分支保留供复核。

## 2026-09-14 全页面文案与参考 UI 复核

- `AGENTS.md` 写入硬性约束：禁止解释性小字、常驻说明、教学与口径横幅，也不转移到 tooltip 或说明弹窗；以状态、选择、校验、操作入口和业务数据表达。
- 移除首页待补录/期初横幅、现金流说明、损益说明、图表日期解释及科目范围说明。另移除编辑教学、摘要更新说明、登录权限说明及空状态教学。待补录改为铃铛入口与状态；日期边界由控件转换。
- 首页增加四项报表切换，余额与趋势进入各自面板；净资产主卡增加真实截止余额曲线和显隐操作；总览只保留参考图的主要卡片序列。流水增加月度汇总、迷你柱图、收支筛选、真实类别图标与正负金额。
- 补录改为紧凑字段行、交易摘要、操作菜单和底部双按钮。简单收支同步双边金额、切换方向；相同商户的历史完整交易提供手动科目建议。复杂交易与退款保留完整分录编辑，原记录和分录 ID 不变。
- `pnpm typecheck`：0 errors / 0 warnings；`pnpm test`：9 文件、52 项通过；`pnpm build`、`git diff --check` 通过。新增覆盖页面面板与隐私、日期转换、金额方向、简单/复杂分录、建议应用、类型切换和全业务页面文案回归。
- 不新增或修改数据库表、字段、视图、函数和权限。未运行真实 Auth0 JWT/API、数据库写入、浏览器/真机及生产部署验收；源码布局与自动化 DOM 检查不冒充像素验收。
- 完整差异清单见 [UI-AUDIT](UI-AUDIT.md)。最终提交与远端核验结果见本次交付消息。

## 2026-09-14 参考设计与未来30天现金流

- 首页调整为净资产主卡、两列资产/负债摘要、通栏现金流、横排损益和最近三笔交易；保留损益趋势、科目余额、完整性提示及下钻。按参考图统一浅蓝灰背景、圆角白卡及深浅语义色。流水与补录页增加方向图标、待补录标签及已保存交易摘要。
- 用户确认“未来30天”按已录入的未来交易统计。默认显示净流入、流入/流出和每6天一组双柱图，支持切换所选月份；空数据、缺现金科目、失败及金额隐藏独立处理，提供精确金额明细表。
- 不新增表、字段、视图或函数。合计与分组均调用既有 `overview` SQL；前端只划分日期及绘图。首次有流量时未来图额外调用1次合计和5次分组查询。分组并发、缓存5分钟，金额隐藏/空流量时不请求分组。保存后沿用 overview 缓存失效。
- `pnpm typecheck`：0 errors / 0 warnings；`pnpm test`：7文件、39项通过；`pnpm build`、`git diff --check` 通过。新增验证覆盖跨年日期边界、分组裁剪、现金/损益口径区分、未来下钻、失败与空状态、缺现金科目；保留隐私及交易编辑回归。
- **本次未运行真实 Auth0 JWT/API、数据库写入、浏览器/真机或生产部署验收。** 遵照项目既有不使用浏览器的要求。Git 交付到 `main`，提交与远端核验见本次交付消息。

## 2026-09-14 前端框架重构

- 替换为 Svelte 5、Bits UI、shadcn-svelte、Tailwind CSS 4、Lucide。官方 CLI 应用 preset `b6sUj31yy`（Maia / Mist / Inter / Lucide / 零圆角），基础组件源码与主题变量纳入版本管理。
- 总览、流水、交易编辑和科目设置全部迁移；保留原路径、筛选下钻、分页、金额隐藏、深浅主题及移动布局。
- 同笔退款保留原分录 ID；保存失败保留输入，网络结果不明确时阻止重复提交。导航、后退、刷新保留未保存提醒。
- Auth0 React 包替换为官方 SPA SDK，保留 PKCE、内存 token、本人 subject、原 audience/connection。数据库 API 封装与 SQL/表结构未变。
- React、MUI、React Hook Form、React Router、Recharts 依赖与 TSX 全部移除。趋势使用 SVG，并增加可展开的逐日文本明细。
- `pnpm typecheck`：svelte-check 0 errors / 0 warnings；`pnpm test`：6 文件、31 项通过；`pnpm build` 与 `git diff --check` 通过。
- 自动化覆盖退款原 ID、失败输入保留、重复保存保护、下笔加载失败及科目搜索选择。另检查查询筛选/分页、未知金额、报表下钻/隐私、科目保存和历史返回。Auth0 覆盖回调、安全返回路径及清缓存。
- 构建按页面及 Auth0 SDK 分包，入口 JS 308.62 KB（gzip 96.02 KB），Auth0 SDK 205.95 KB（gzip 58.94 KB）；无大于 500 KB 的 chunk 提示。这里是静态构建体积，不是实际加载耗时。
- **本次未运行真实 Auth0 JWT/API、数据库写入、浏览器/真机或生产部署验收。** SQL 与生产配置没有变更；遵照既有不使用浏览器的验证要求。
- 交付分支：`refactor/svelte5-shadcn`。提交、远端核验结果见本次交付消息。

## 2026-09-13 实现与发布记录

以下是前一版本的历史验收与生产基线，不代表本次重构重新执行了这些步骤。

## 最终范围

**保留原始三张表及全部原字段，不新增业务表或表字段。** 所有视图、函数在 financial，视图无 v_ 前缀。现金范围直接使用既有“资产 / 现金及等价物”子类；退款在同一 transaction 内补记。

## 已完成

| 项目 | 结果 |
| --- | --- |
| Auth0 | 刷新 CLI 登录，复用北极小站 SPA，配置 financial audience、本地/生产回调；启用本人所在 eastmoney-email 连接 |
| 程序化登录 | 按用户要求完成；本地 .env 权限600、Git忽略，密码不进入构建；测试临时 grant 已恢复 |
| 数据库 | 生产部署 RLS、3个视图及查询/保存函数；没有新增表字段 |
| 总览 | 资产负债、现金流、损益、趋势、科目余额、质量数量、指标下钻 |
| 流水 | 手机卡片、日期分组、搜索/筛选、游标分页、新增与补录、科目匹配、分录拆分 |
| 退款 | 在同一交易追加反向分录，保留原分录ID，卡片和报表按净额计算 |
| 科目 | 仅编辑原有 type/subtype/name/notes；现金范围自动识别 |
| 交互 | 移动全屏编辑、底部操作、借贷差额、保存中禁重复、失败保留输入、返回提示、金额隐藏、深浅主题、减少动效 |
| Cloudflare | financial Worker 与 financial.hasbai.xyz 自定义域名已发布；首页与 /transactions/1 返回200 |
| GitHub | 实现已纳入本次提交，同步结果见最终交付消息 |

## 验证证据

- `pnpm typecheck` 通过。
- `pnpm test`：3个测试文件、10项通过；包括同笔退款表单和失败保留输入。
- `scripts/test-database.mjs`：21项通过，包含原始列集合、只有3张表、本人权限及借贷/精度校验。另检查原子回滚、updated_at 冲突、同笔退款、自动现金流及三表样例。测试记录已回滚。
- 隔离分支真实 Auth0 JWT：科目读取、分页、总览、新增、修改、同笔退款通过；测试数据已清理。
- 生产真实 Auth0 JWT：本人读取、分页、总览、非法写入拒绝、无 token、伪造签名、错误 audience 无数据均通过。错误 audience 由 SQL/RLS 拒绝，不能声称 Neon 网关已单独拦截。
- 生产 Data API CORS 预检通过；保留原 public/financial schema 暴露设置和其他消费者配置。
- 构建通过，页面按路由分包；主包仍有体积提示（gzip约265KB），属于后续可优化项，不影响构建通过。
- 发布后 HTTP 检查通过，SPA深链接正常；构建JS未包含测试邮箱或密码。
- **未执行完整浏览器/真机视觉验收**：用户明确改为程序化登录并要求不使用浏览器。此前仅查看登录入口，不计完整UI验收。

## 原始数据保持

生产及隔离分支最终数据校验一致，生产迁移前后也一致：

| 表 | 行数 | 行内容 MD5 |
| --- | ---: | --- |
| account | 86 | 7918861032482202df0191d684e19bda |
| transaction | 548 | d4f88ecde463e0a7bd9166fd21d53dde |
| entry | 1012 | 212ec258347d677e1922b17ac8eebf98 |

报表当前纳入439笔完整成功/退款交易；缺分录28笔、缺科目64笔，待补录合计92笔。现有现金科目7个，无需另配标记。历史41笔退款未找到相同 payment_id 的成功交易，不猜测合并，不改写历史记录；新增退款功能始终在当前交易内操作。

## 发布与后续

Worker发布版本记录在本文末尾。数据库迁移保持原始表结构，原数据不变。开发分支 financial-implementation 保留供后续验证，前端默认访问 production。

后续仅按实际使用反馈修正；不恢复多账本、草稿、审计、版本字段或退款子交易设计。

最终 Worker 版本：`479353c5-d0fd-4f45-83a1-97b5b9224067`。生产 `financial.hasbai.xyz` 首页与深链接200，CORS预检200。

## 2026-09-18 登录与账目维护（验收中）

已实现自动登录恢复、科目分级与编号编辑/删除、新增保存返回流水、修改交易与级联删除。007 数据库迁移、CI 和部署结果待下方补记；未声称真机验收。

数据库已验证：隔离 br-old-hat-b3j40jc8 与生产 br-billowing-violet-b3pkbm3s 的007定义一致，基础62项、余额历史41项均通过，写入回滚；真实JWT/API及首页6 GET/暖缓存0额外GET通过。生产三表指纹前后不变，前端CI/部署继续验证。

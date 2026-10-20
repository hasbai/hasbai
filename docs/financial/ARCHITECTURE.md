# 财务架构

Svelte 5 + TypeScript + Vite SPA，Bits UI / Luma、Tailwind CSS 4、Lucide、pnpm。Worker `financial` 只托管静态资源，浏览器直接通过 `packages/data` 的 PostgREST 客户端请求 Neon Data API；业务读取视图与写函数位于 `financial`。本页源码及脚本路径相对 `apps/financial`。

```mermaid
flowchart LR
  SPA[Svelte SPA / Worker financial] -->|登录| AUTH[Auth0 北极小站]
  SPA -->|用户 Access Token| API[Neon Data API]
  API -->|验证 JWT / 数据库 role| DB[三表 / GRANT / 原报表 / 写函数]
```

## 接入与资源

共享登录、claims、audience、permission 与数据库角色分工见[AUTHORIZATION](../AUTHORIZATION.md)；开发边界见[财务入口](README.md)。公开配置在 `src/lib/config.ts`，默认生产 endpoint；测试可用 `VITE_DATA_API_URL` 指定已迁移分支。

既有 Neon 项目 `mute-king-39794724` / neondb：production `br-billowing-violet-b3pkbm3s`，开发分支 `br-proud-bread-b3hl3asf`。这些是既有资源登记，操作前回读目标分支，不用开发副本覆盖生产。数据库、真实 JWT/API 验证和维护脚本见[DATABASE](DATABASE.md)。

## 应用结构

- `src/pages`：总览、流水、编辑、设置与科目。
- `src/lib/api.ts`：使用 Neon PostgREST SDK，自动取得 Auth0 token。直接 GET balance、balance_history、cashflow、income_statement、transactions 和 account；数值列取十进制字符串，客户端 Decimal 完成汇总、分类、日期分组和首页结构组装。只有保存使用 RPC。
- `@tanstack/svelte-query`：通过 Svelte 5 accessor 查询缓存、游标分页与保存后刷新。
- `src/lib/reports.ts`：报表片段与源行共用 QueryClient 内存缓存；首页从现有报表并发读取，后续明细复用源行，不为一次 HTTP 再拼后端 home 视图。关闭金额时不取余额历史。
- balance/balance_history 物化视图直接授予 superadmin SELECT；保存完成后在同一事务刷新。外部批量维护使用 scripts/refresh-balances.mjs。
- 保存使 overview/transactions 及其源行查询失效；科目只读取一次完整列表，首页现金配置与流水标签共同复用。报表、源行、科目及精确截止时点在当前页面会话内保留，不因30秒过期、切页、聚焦或重连重复获取。跨北京时间日期后重新进入页面刷新报表；保存后刷新受影响数据，浏览器刷新重建会话并重新读取，退出清空同一个 QueryClient。历史余额直接读取每日快照，现金图一次按日聚合，不再每六天重复查询。
- `Repository.overview` 保留核对入口，其余额采用新物化视图，现金和损益使用现有视图；不读取已删除的 balance_sheet/cashflow_statement。
- Svelte 5 runes：编辑状态与分录数组；快照提交，原分录 ID 和 updated_at 保留。
- Decimal.js + SQL numeric：金额输入与计算。
- Svelte SVG：趋势展示及逐日可访问明细；坐标用 Number，仅用于呈现，基础报表金额来自 SQL，页面汇总采用 Decimal。

- `src/lib/auth.svelte.ts`：Auth0 初始化、回调、登录/退出及取 Access Token。SDK 随入口加载，静默恢复超时为3秒；没有恢复会话则自动通过顶层 Auth0 跳转登录，sessionStorage 仅存防循环与主动退出标记，不存 token。主动退出后保留手动登录入口；回调错误不自动重试。
- `src/lib/router.svelte.ts`：History API 路由、查询字符串、返回与未保存提醒；保持原 SPA 路径。
- `src/lib/context.ts`：Svelte context 注入 Repository；测试注入替身，不加入生产绕过认证开关。
- `src/lib/editor.ts`：表单初始化和退款分录输入；SQL 负责最终保存校验。
- `svelte-check` 同时检查 Svelte 与 TypeScript；TypeScript 6 是当前 svelte-check 声明支持的主版本。

## 发布与回滚

应用 `wrangler.jsonc` 配置 dist、SPA 回退与 `financial.hasbai.xyz`；`public/_headers` 维护缓存和安全头。根 Wrangler 入口保留兼容，Workers Builds 自动构建登记见[Monorepo 架构](../ARCHITECTURE.md#自动构建与运行入口)。交付按[TESTING](../TESTING.md)执行；应用资源与自动 Build SHA 独立核验。

回滚优先退回 Worker 版本，数据库仍保留原字段/记录。共享 Neon provider 修改前核查原消费者，不调整其他 Auth0 application。当前实现与证据边界见[PROGRESS](PROGRESS.md)。

## 首页请求复用

- 冷启动需要六类源 GET（分页超过1000行时有续页）：balance、income_statement、cashflow、transactions质量、account完整科目、balance_history。隐藏金额时省去余额历史，共五类。
- account不再单查“现金及等价物”ID；完整科目列表供首页配置判断、流水筛选、科目设置及编辑共用，保存科目后全量失效，保存交易不重读科目。
- 首页资产/损益/每日历史面板复用原始行；cashflow优先复用已缓存且覆盖所需半开时间区间的完整行，再用原有微秒边界裁剪。历史余额缓存按实际请求日期键控。
- 隐藏后首次显示金额只补余额历史；失败重试只重读失败源。所有源缓存位于应用注入的同一QueryClient，不保存到localStorage，退出清空也覆盖在途查询。
- Auth0 oauth/token属于登录/续期，Cloudflare cdn-cgi/rum属于性能上报；Google Play log未在项目源码中引入，不能仅凭URL认定其具体发起方。

## iOS PWA

manifest 声明北极账本、standalone、同源 scope/start_url 和图标；同时提供180px Apple Touch Icon。Vite build 完成后 scripts/build-pwa.mjs 按 index、manifest、icons、assets 的内容生成有版本的 sw.js 和静态资源清单。

Service Worker 只预缓存公开应用资源；不拦截跨域Auth0/Neon、非GET、Authorization请求，也不缓存带查询参数的资源或任何运行时API响应。受控导航优先以no-store请求规范根路径/，失败或非HTML成功响应时回退当前完整安装版本的应用壳；不把在线页面写入另一版本缓存。

新SW完整预缓存后skipWaiting并clients.claim，后续刷新取得线上版本；不调用页面reload或Client.navigate，不打断正在填写的交易。旧页面仍可能加载旧哈希chunk，因此有打开窗口时保留旧版本静态缓存并按精确资源路径查找；仅激活时确认没有打开窗口才清理旧financial-static缓存，不触碰其他应用缓存。应用启动、回到前台、恢复网络时检查SW更新，合并在途检查，离线失败等待下次事件重试。

账本查询只放内存；登录缓存见[共享授权规则](../AUTHORIZATION.md)。
不增加离线数据库、离线保存队列或后台写入。

编辑期间断网保留当前内存输入，禁用保存；网络恢复允许提交，结果不明确仍沿用待核对状态禁止重复写入。冷启动离线只能取得应用壳；业务读取和过期登录续期需要网络。

mobile-viewport.ts 使用 VisualViewport 高度和offsetTop适配键盘；放大时不覆盖系统缩放。仅正常尺寸更新CSS变量，弹层焦点与滚动锁使用Bits UI。手机交易路由只挂载编辑页面，EditorSurface 在手机渲染普通页面、桌面使用Dialog；手机页面及科目选择均适配VisualViewport，避免应用菜单或底栏覆盖编辑操作。PWA standalone中的真实登录、安装、系统返回和键盘行为需单独真机验收，程序化JWT/API不替代此项。

PWA导航缓存使用规范URL `/`，不预取会被Cloudflare重定向的`/index.html`。导航响应的redirected标记需清除后才能用于redirect=manual的浏览器导航。2026-09-15修复版在install阶段重建旧缓存的redirected /index.html响应，保留旧版正文/资源，允许仍活跃的旧SW恢复导航；不等待新SW激活才修复。回归通过真实HTTP307验证，而非仅比对文件内容。

2026-09-16更新修复：原cache-first + waiting策略会使普通刷新继续命中旧应用壳，线上资源与dist一致不能证明已安装PWA已更新。现已增加安装/激活/导航/旧chunk/离线回退的生命周期回归；旧SW首次检测并安装修复版期间仍可能显示旧页，接管后再刷新即可取得新版。真机已安装客户端的状态仍需单独核验。

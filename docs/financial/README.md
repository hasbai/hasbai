# Financial · 北极账本开发入口

`apps/financial` 是单人个人财务系统，使用 Svelte 5 SPA。Worker `financial` 在 `financial.hasbai.xyz` 托管静态资源。所有相对路径以 `apps/financial` 为工作目录。

## 用户确认的业务边界

- 系统只服务单人、人民币。访问由 Auth0 `superadmin`、`financial.all:all` 与数据库授权管理（见 [AUTHORIZATION](../AUTHORIZATION.md)）。
- 只使用 `financial.account`、`financial.transaction` 与 `financial.entry` 三表及原字段。不得新增表字段（如 `is_active`、`is_cash_equivalent`、`version`、退款关联字段）。不得新增业务 schema 或 `ledger`、`member`、`draft`、`audit` 扩展表。不得为多用户或家庭共享预设计。
- 现金范围直接取资产下「现金及等价物」子类。退款追加同一 `transaction`。视图不得用 `v_` 前缀。不得增加 `home`、`*_read`、`*_daily` 包装视图或读取 RPC。
- 迁移必须保留原记录与 ID，不得批量猜测合并或改历史状态。已授权通过界面修改科目 ID、删除单笔交易及分录、删除无引用科目。
- Data API 验签 JWT，PostgreSQL 用 schema 与对象 GRANT 授权。读视图使用 `security_invoker`，写函数固定 `search_path`。客户端无基表 DML，不得增加 SQL 身份重复封装。
- 数据库金额用 `numeric`（接口转十进制字符串）。前端用 Decimal 执行汇总、分组、日期与格式化。

## 按任务读取

| 任务 | 文档 | 代码入口（相对应用目录） |
| --- | --- | --- |
| 运行、接入、缓存与 PWA | [ARCHITECTURE](ARCHITECTURE.md) | `src/lib/config.ts`、`src/lib/reports.ts`、`src/lib/pwa*`、`scripts/build-pwa.mjs` |
| 页面、文案与参考 UI | [DESIGN](DESIGN.md)（修改页面必读） | `src/pages`、`src/components` |
| 表、视图、写入、迁移 | [DATABASE](DATABASE.md) | `../../database/migrations`、`src/lib/api.ts` |
| 金额、日期、退款与报表口径 | [DOMAIN](DOMAIN.md) | `src/lib/finance.ts`、`src/lib/cashflow.ts` |
| 分层测试与浏览器矩阵 | [TESTING](TESTING.md) | `vite.config.ts`、`playwright.config.ts`、`visual-coverage.json` |
| 已实现与待验收 | [PROGRESS](PROGRESS.md) | 当前 `main` 与证据入口 |
| 历史追溯（非当前约束） | [交付](history/DELIVERY.md)、[UI 排查](history/UI-AUDIT.md)、[现场基线](history/BASELINE.md)、[旧规划](history/PLAN.md) | 历史快照 |

本地检查、隔离 Neon 验证、提交与发布见 [共享 TESTING](../TESTING.md)。

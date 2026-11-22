# 数据库与 API

业务边界以[财务入口](README.md#用户确认的业务边界)为准；脚本路径相对 `apps/financial`，迁移位于仓库根 `database/migrations`。

## 数据读取与权限

- **业务视图**：保留 `balance`（物化当前科目余额）、`balance_history`（物化每日累计余额）、`cashflow`（逐笔净现金流 `transaction_id` / `occurred_at` / `net`）、`income_statement`（损益）、`transactions` 与 `statement_entries`（有效分录）。006 已删除 `home`、`*_read`、`cashflow_daily`、`read_*`、`overview`、`get_accounts`、`transactions_page` 等包装对象，禁止重建或新增页面专用视图。
- **PostgreSQL 授权**：JWT claims 与 `financial.all:all` 见[AUTHORIZATION](../AUTHORIZATION.md)。`superadmin` 为 `NOLOGIN`/`NOSUPERUSER`/`NOBYPASSRLS` 角色（`authenticator` 与 `neondb_owner` 可切换），仅拥有 schema USAGE、三表与现行视图 SELECT 及公开写/删函数 EXECUTE（无基表 DML 或直接刷新权限）；`anonymous`、`authenticated` 与 `PUBLIC` 权限已撤销，三表 RLS 关闭。
- **写函数**：保存/删除函数以 `financial_writer` 执行、固定 `search_path`，校验借贷平衡、金额、`updated_at` 冲突、分录 ID 与同笔退款，并在同一事务以 advisory lock 调用内部 `refresh_balances`（`transaction_detail` 与 `refresh_balances` 不暴露给 `superadmin`）。

## 金额、日期、科目编号与删除

- `numeric` 转 `text` 返回，前端用 Decimal 汇总；按稳定唯一顺序每 1000 行分页，并发同请求去重。日期采用北京时间，现金流与损益用半开区间。`balance` 仅排除同笔缺科目的交易并含已录入未来交易；`balance_history` 累计至维护当天。外部批量维护后从 stdin 传入管理连接串执行 `node scripts/refresh-balances.mjs`。
- **科目编号与删除（007）**：`save_account(integer, jsonb)` 支持显式五位 ID（`p_id` 为修改前 ID；首位 1–5 对应资产/负债/净资产/收入/支出，中间两位子类，末两位序号；同子类保持前三位；未传 ID 从对应子类分配空闲号）。单科目改号通过 `ON UPDATE CASCADE` 同步 `entry.account_id` 并刷新关联交易 `updated_at`。`delete_transaction(integer, timestamptz)` 校验 `updated_at` 后级联删除全部分录；`delete_account(integer)` 仅删无引用科目；两者均同事务刷新余额。

## 验证与切换

- `scripts/test-database.mjs`（三表字段、退款、精度、保存回滚、授权、现金损益）与 `scripts/test-balance-database.mjs`（历史连续、北京时间边界、回补、pending 与未来交易）：连接串从 stdin 传入，测试写入全部回滚。
- `scripts/check-api.mjs`（`DATA_API_URL`）：真实 Auth0 PKCE 验证 `role=superadmin`、读取与网关拒绝；`scripts/check-home-api.mjs`（`VITE_DATA_API_URL`）：验证首页组装。
- 迁移与发布流程见[共享 TESTING](../TESTING.md#数据迁移与发布核验)；006/007 历史证据见[历史交付](history/DELIVERY.md)。

# 数据库与 API

业务范围以[财务入口](README.md#用户确认的业务边界)为准。本页维护当前读取、写入与维护契约；脚本路径相对 `apps/financial`，迁移位于仓库根 `database/migrations`。

## 数据读取

- balance：用户维护的当前科目余额物化视图，保留原定义。
- balance_history：已有每日科目累计余额物化视图，前端按日期汇总曲线，按选定日读取月末余额。
- cashflow：用户现有逐笔净现金流，列 transaction_id、occurred_at、net；前端拆分正负流量、按日汇总。分类需要时读取 statement_entries 判断生活、投资、筹资。
- income_statement：已有损益报表，前端汇总期间金额、分类及每日收支。
- transactions / statement_entries：既有流水与有效分录业务视图，保留当前业务纳入规则、筛选和保存返回契约。

006 删除 home、balance_read、balance_history_read、cashflow_read、cashflow_daily 和 read_balance、read_balance_history、overview、get_accounts、transactions_page。不新增页面专用视图，不重建已删除的 balance_sheet/cashflow_statement。历史迁移保留用于追溯，不代表当前应用继续依赖旧对象。

## 权限

JWT claims、audience 与应用 `financial.all:all` 门禁统一见[AUTHORIZATION](../AUTHORIZATION.md)。Data API 验证 JWT 后按 `.role` 切换 PostgreSQL 角色；应用 permission 检查不替代数据库 GRANT，也不增加 SQL 身份重复校验。

superadmin 是 NOLOGIN/NOSUPERUSER/NOBYPASSRLS 的业务角色，authenticator 与管理用 neondb_owner 可切换到它。superadmin 具有 schema USAGE、三表及现有业务视图 SELECT，以及公开保存/删除函数 EXECUTE；没有基表 DML 或直接刷新权限。anonymous、authenticated 和 PUBLIC 的 financial 访问授权撤销。旧 is_owner、personal_read/personal_write 已删除，三表 RLS 关闭。

保存函数继续以 financial_writer 执行，固定 search_path，保留借贷/金额校验、updated_at 冲突、分录 ID 及同笔退款。transaction_detail 仅作保存内部返回助手，refresh_balances 仅作内部刷新，两者都不暴露给 superadmin 执行。

## 金额、日期与刷新

numeric 列在请求中转 text，前端 Decimal 汇总，不经 JavaScript Number 计算业务金额。按稳定唯一顺序每1000行分页；同一报表同时读取时复用进行中的请求。日期采用北京时间，现金及损益使用精确半开区间。当前首页由客户端固定同一 as_of 用于筛选、分组和下钻，这些请求不构成数据库原子快照。

balance 的纳入规则仅排除同笔科目缺失，包含已录入未来交易。balance_history 沿用该规则，按北京时间日末累计至维护当天；存在未来交易时最新历史不必等于当前余额。

保存交易/科目后同一事务调用 refresh_balances，以 advisory lock 串行化刷新两个物化视图；不设 cron 或分录触发器。外部批量维护后经 stdin 将管理连接串传给 node scripts/refresh-balances.mjs，一次性刷新两个对象。

## 验证与切换

scripts/test-database.mjs 验证三表字段、退款、精度、保存回滚、角色授权和现金损益。scripts/test-balance-database.mjs 验证历史连续、北京时间边界、回补、pending 与未来交易。所有测试写入均回滚，连接串只从 stdin 获取。首页前端组装由 API/组件测试及 scripts/check-home-api.mjs 验证；原 test-home-database.mjs 随 home 视图移除。

scripts/check-api.mjs 使用真实 Auth0 PKCE 验证顶层 role、直接读取及网关拒绝；DATA_API_URL 指定目标。check-home-api.mjs 用 VITE_DATA_API_URL 指定已迁移分支。

迁移和生产/API 核验的执行流程只在[共享 TESTING](../TESTING.md#数据迁移与发布核验)维护；006/007 迁移的既有证据见[历史交付](history/DELIVERY.md)。

## 科目编号与删除

007 保留三表和既有字段，`save_account(integer,jsonb)` 的 payload 支持显式五位 ID；p_id 始终是修改前 ID。首位对应资产1、负债2、净资产3、收入4、支出5，中间两位为子类，末两位为序号；已有同名子类保持相同前三位。旧客户端未传新增 ID 时从对应子类分配空闲编号，不再使用与历史编号脱节的 identity 序列。迁移本身不修改既有记录或编号。

用户明确请求单科目改号后，既有 ON UPDATE CASCADE 同步 entry.account_id。分录和交易 ID 不变。同步更新关联交易 updated_at，阻止旧编辑器覆盖。

`delete_transaction(integer,timestamptz)` 按 updated_at 检查后级联删除所有分录，包括退款分录；`delete_account(integer)` 仅删除无分录引用的科目。两者固定 search_path、以 financial_writer 执行、仅授予 superadmin EXECUTE，基表 DML 继续禁止。保存和删除同事务刷新余额。

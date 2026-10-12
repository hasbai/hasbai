# 现场核查基线

> 历史记录：保留当时的方案、命令与验收证据，不作为当前开发或发布规范。当前入口见[文档导航](../../README.md)。

检查日期：2026-09-13，Asia/Shanghai。采用 Neon MCP SELECT、GitHub CLI、Auth0 CLI 与只读 HTTP 请求；本轮未修改数据库、Auth0、Cloudflare 配置或数据。

本文件是时间点快照，后续实现必须重新检查。只记录结构和聚合质量，不保存个人金额、商户、账户名称、完整流水或凭据。

## 1. 已确认的环境

| 对象 | 结果 |
| --- | --- |
| 本地目录 | `/Users/yueshi/src/financial`，开始时为空，无 Git 仓库 |
| GitHub | 当前身份 hasbai；初查未找到仓库，本轮成功创建私有 `hasbai/financial` |
| 工具链 | Node.js v24.14.1、pnpm 10.33.2；未安装项目依赖 |
| Neon 项目 | hasbai，`mute-king-39794724`，aws-ap-southeast-1 |
| PostgreSQL | 18 |
| 分支 | production，`br-billowing-violet-b3pkbm3s`，default=true |
| 数据库 / schema | `neondb` / `financial` |
| Data API | active；暴露 public 和 financial；max rows=1000；aggregates=true；role claim=.role；OpenAPI disabled |
| Auth0 | CLI 本地登记 tenant 为 hasbai.eu.auth0.com；请求 application/API 列表时会话过期 |
| 目标站点 | `https://financial.hasbai.xyz` 本次 HEAD 返回 HTTP 502，Server: Caddy；不代表已部署本项目 |

Data API endpoint：

```text
https://ep-long-dew-b3q1him6.apirest.c-4.ap-southeast-1.aws.neon.tech/neondb/rest/v1
```

这是公开地址，不是访问凭据。调用 `GET /account?select=id&limit=0` 并设置 `Accept-Profile: financial`，未带 token 时返回 HTTP 400，错误为 `missing authentication credentials: required authorization bearer token in JWT format`。此检查未读取数据，也不能替代完整的 JWT/越权测试。

当前 Data API 返回值不含 provider/JWKS/audience 明细，CORS 允许来源也未得到确认。“北极小站存在”来自用户描述，本轮未能从 Auth0 管理接口核实 client ID、类型、回调或 audience。

## 2. 既有表与对象

| 对象 | 字段/特性 |
| --- | --- |
| `financial.account` | id integer identity BY DEFAULT；type 枚举；subtype、name 必填；notes 可空 |
| `financial.transaction` | id integer identity ALWAYS；occurred_at/created_at/updated_at timestamptz；status、payment_method、payment_id、notes、merchant 可空；时间默认 CURRENT_TIMESTAMP；付款渠道默认 direct |
| `financial.entry` | id integer identity ALWAYS；transaction_id 必填；direction 借/贷；account_id 可空；amount numeric(12,2) 必填 |
| `financial.get_accounts()` | SQL 函数，返回 jsonb；按 type/subtype/名称与 notes 聚合；SECURITY INVOKER |

没有 financial 视图/物化视图，没有用户定义触发器。三张表都有主键；transaction 有 occurred_at 索引，entry 的两项外键有索引。未发现借贷平衡、amount > 0 等检查约束。

现有 FK：entry.transaction_id → transaction.id，ON UPDATE CASCADE / ON DELETE CASCADE；entry.account_id → account.id，ON UPDATE CASCADE / ON DELETE SET NULL。

枚举均位于 financial：

- first_account：资产、负债、净资产、收入、支出。
- direction：借、贷。
- payment_method：direct、支付宝、微信、云闪付、Apple。
- transaction_status：success、pending、cancel、refund、partial_refund。

ID 的 `column_default` 为空不等于没有自增：实际 identity 已另外查询确认。

## 3. 数据规模与补录需求

以下使用精确 COUNT，不采用 pg_class 的估计行数。

| 指标 | 数量 |
| --- | ---: |
| 科目 | 86 |
| 交易 | 548 |
| 分录 | 1,012 |
| 科目缺失的分录 | 64 |
| 涉及科目缺失的交易 | 64 |
| 无分录交易 | 44 |
| 借贷净差不为零的交易 | 0 |
| 金额 ≤ 0 的分录 | 0 |
| status 为空的交易 | 0 |
| merchant 空值或空白的交易 | 41 |

“借贷净差为零”只说明已有分录算术平衡，零分录也会得到零差额；不等于所有交易完整可入账。商户为空也不必然是错误。

| 付款状态 | 交易数 | 无分录 | 缺科目交易 |
| --- | ---: | ---: | ---: |
| success | 490 | 28 | 56 |
| pending | 1 | 0 | 0 |
| cancel | 16 | 16 | 0 |
| refund | 41 | 0 | 8 |
| 合计 | 548 | 44 | 64 |

无分录与缺科目的交易在此统计中不重叠。成功交易至少有 84 笔需要分录/科目补全；另有 8 笔退款交易缺科目。16 笔 cancel 无分录不能直接列作应补录交易，退款含义仍需逐类核对。

科目类型数量：资产 13、负债 6、净资产 1、收入 9、支出 57。现有模型已经支持复式记账，无需另起简单收支表覆盖旧数据。

## 4. 授权现状

- account、transaction、entry：RLS=false，FORCE RLS=false，没有 financial 策略。
- anonymous 和 authenticated：均无 financial schema USAGE，均无三张表 SELECT，均无 BYPASSRLS。
- 两个角色对 get_accounts() 的函数 EXECUTE 检查为 true，但缺 schema USAGE 和底表 SELECT，不能据此认为该函数目前可读数据。
- 这说明“尚未开放业务数据权限”，不能推导成“当前已公开泄漏”。下一阶段若直接授予读权限而不设置 RLS，则会引入越权风险。

## 5. 验证边界与复查

已核实：对象元数据、精确聚合计数、主要约束/索引/角色有效读取权限、无 token 请求结果和目标域名响应。

未核实：Auth0 应用配置、有效用户 token、JWKS/audience 与浏览器 CORS。退款语义、完整期初/币种、既有导入程序和其他 schema 消费者待核实。Cloudflare 控制台/DNS 及生产发布链路也未核实。

可重跑的聚合查询见 [只读核查 SQL](inspect-financial.sql)。它仅输出结构/质量计数，不执行写入；必须显式选择 hasbai 的目标分支和 neondb。详细元数据可再查询 information_schema、pg_constraint、pg_policies、pg_indexes 与权限函数。

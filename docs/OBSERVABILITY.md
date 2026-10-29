# 日志与链路追踪

四个动态 Worker 共用 `packages/observability` 的请求摘要。
配置以各应用的 `wrangler.jsonc` 为准。

## 采集策略

| 应用 | 日志采样 | invocation 日志 | 自动 traces |
| --- | --- | --- | --- |
| Blog | 100% | 开启 | 1% |
| Images | 100% | 开启 | 1% |
| Zboard | 100% | 关闭 | 关闭 |
| Tavern | 100% | 关闭 | 关闭 |
| Financial | 静态托管，无应用 Worker 日志 | 不适用 | 不适用 |

普通日志采用全量采集，避免 head sampling 同时丢弃错误日志。
这不是持久化保证；平台限额、运行时终止和采集故障仍可能造成缺口。
所有动态 Worker 开启 `redact_query_string`。

Zboard 的订阅令牌位于路径中；Telegram 上游 URL 也包含机器人令牌。
查询参数脱敏不能覆盖这些路径，因此两个应用停用自动 traces。
不新增 Tail Worker、Logpush 或外部日志服务。

Financial 的浏览器直连 Neon Data API。
静态资源请求不执行用户 Worker，不能靠 observability 配置取得业务日志。
本方案不改变资源路由，也不新增浏览器遥测。

## 自定义字段与隐私

每次 HTTP 请求记录一条 `event=http_request`。
字段为 `service`、`version`、`level`、`method`、`route`、`status` 和 `response_ready_ms`。
`route` 使用固定分类；动态 ID、订阅令牌和未知路径不写入该字段。
不读取或记录请求正文、认证头、Cookie、查询参数和原始异常消息。

4xx 使用 `console.warn`，5xx 使用 `console.error`，其他响应使用 `console.info`。
请求上下文与版本也可用 Cloudflare 自动附加的字段关联。

摘要计时到返回 Response 为止，不消费响应流。
它不表示 SSE 全部生成完成或全部字节传输耗时。
Tavern 的 `generation_outcome` 记录后台生成结果和模型用量。
`generation_persist_failed`、`lore_keyword_fallback` 使用同一结构化对象格式。
业务日志不写提示词或对话正文；AI Gateway 仍按现有业务约定保存请求与回复。

以上脱敏范围是自定义字段。
Cloudflare 仍会自动附加运行时元数据，关闭 invocation 日志不等于移除全部请求元数据。
平台异常、Issues、实时 tail 或导出可能包含更多信息，不应当作匿名日志共享。
未来启用路径含密钥的链路追踪前，先移除路径凭据或验证存储前脱敏方案。

## 排障

在 Cloudflare 的 Workers & Pages 中选择应用，再打开 Observability。
筛选 `event=http_request` 和 `status>=500` 定位失败路由。
按 `service`、`route`、`version` 分组，检查数量与 `response_ready_ms` 的 p95。
按请求关联字段查看相邻日志；只用摘要计数，避免重复计算 invocation 日志。

Tavern 生成失败需同时检查 `generation_outcome` 的 `status` 和 `finishReason`。
HTTP 200 或流已建立不能证明后台生成成功。

实时排障在应用目录运行：

```sh
pnpm exec wrangler tail --format json
```

不要把原始 tail 输出附在公开 issue 或 PR 中。
生产配置由 Workers Builds 随 main 自动发布，交付路径见 [TESTING](TESTING.md)。

## 用量估算

基线为 GraphQL `workersInvocationsAdaptive` 的聚合请求数。
区间为北京时间 2026-10-22 08:00 至 2026-10-29 08:00，共七天。
该数据集会自适应采样，数字属于估计值。

| Worker | 七天请求 | 按 30 天外推 | 基础日志/月 |
| --- | ---: | ---: | ---: |
| Blog | 8,257 | 35,387 | 70,774 |
| Images | 92 | 394 | 788 |
| Zboard | 20,090 | 86,100 | 86,100 |
| Tavern | 1,830 | 7,843 | 7,843 |
| 合计 | 30,269 | 129,724 | 165,505 |

基础日志包括一条请求摘要，以及 Blog/Images 的一条 invocation 日志。
后台生成、DO、alarm 和其他自定义日志另计。
初步预算为每月 17–20 万条日志、约 1,800 个 trace spans。
span 数按 Blog/Images 每个采样请求约五个 span 估算，发布后需要实测。

若每条日志及附加字段占 1–3 KB，预估月摄入约 0.2–0.7 GB。
按均匀流量和七天保留估算，稳定存储约 0.05–0.17 GB-month。
字节数是容量假设，不是已测量账单；长元数据或流量峰值会增加用量。
静态请求、AI Gateway 完整内容及账户其他应用不计入以上数字。

2026-10-29 核对的官方定价：

- 至 2026-11-30：Free 每天 20 万条日志，保留三天。
- 至 2026-11-30：Paid 每月包含 2,000 万条日志，保留七天；超额每百万条 0.60 美元。
- 从 2026-12-01 起：Free 每天包含 0.5 GB 摄入，保留七天。
- 从 2026-12-01 起：Paid 每周期包含 50 GB 摄入和 10 GB-month 存储。
- 新 Paid 超额分别为 0.25 美元/GB 摄入、0.10 美元/GB-month 存储。

按上述流量，本项目预计不产生额外原生日志费用。
额度按账户共享；AI Gateway 等产品也将进入新计价范围。
本次连接没有 Billing Read 权限，不能确认套餐、剩余额度或整个账户账单。
Enterprise 的切换时间按合同续约规则执行。

来源：[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)、[Traces](https://developers.cloudflare.com/workers/observability/traces/)、[Observability 定价](https://developers.cloudflare.com/observability/pricing/)、[最佳实践](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)。

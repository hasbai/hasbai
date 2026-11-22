# 日志与链路追踪

动态 Worker 共用 `packages/observability` 的请求摘要，具体配置以各应用 `wrangler.jsonc` 为准。

## 采集策略

| 应用 | 日志采样 | invocation 日志 | 自动 traces |
| --- | --- | --- | --- |
| Blog | 100% | 开启 | 1% |
| Images | 100% | 开启 | 1% |
| AI | 100% | 开启 | 1% |
| WeChat | 100% | 关闭 | 关闭 |
| Zboard | 除 `/sub/` 外 100% | 关闭 | 关闭 |
| Tavern | 100% | 关闭 | 关闭 |
| Financial | 静态托管，无 Worker 日志（直连 Neon） | 不适用 | 不适用 |

- 普通日志全量采集（避免 head sampling 丢弃错误日志，仍受平台限额影响）；所有动态 Worker 开启 `redact_query_string`。
- Zboard 订阅令牌与 Telegram 上游 Bot 令牌均位于路径中，查询参数脱敏无法覆盖，故两应用停用自动 traces；不新增 Tail Worker、Logpush 或外部日志服务。

## 自定义字段与隐私

- 除 Zboard `/sub/`（成功与失败均不写自定义日志）外，每次 HTTP 请求输出 `event=http_request`，含 `service`、`version`、`level`、`method`、`route`（仅固定分类，不写动态 ID 或未知路径）、`status`、`response_ready_ms`（计至返回 Response，不消费 SSE 流）。4xx 用 `console.warn`，5xx 用 `console.error`，其余 `console.info`。
- 不读取或记录请求正文、认证头、Cookie、查询参数与原始异常消息。Tavern 的 `generation_outcome`、`generation_persist_failed`、`lore_keyword_fallback` 使用同一结构化格式，不写提示词或正文（AI Gateway 按其配置保存 payload）。
- **边界**：以上脱敏仅覆盖自定义字段；Cloudflare 仍可能附加原始 URL 等运行时元数据。实时的 `tail`、平台 Issues 或导出不可作匿名日志共享；路径含密钥的链路追踪启用前须移除路径凭据或先验证存储前脱敏。

## 排障

在 Cloudflare Workers & Pages Observability 中筛选 `event=http_request` 与 `status>=500` 定位失败路由，按 `service`、`route`、`version` 检查计数与 `response_ready_ms` p95（仅用摘要计数，避免与 invocation 日志重复统计）。Tavern 生成失败需同时核对 `generation_outcome` 的 `status` 与 `finishReason`。

实时排障在应用目录执行（原始输出不得附在公开 issue 或 PR）：

```sh
pnpm exec wrangler tail --format json
```

## 用量估算与官方参考

- **基线（2026-10-22 至 2026-10-29，Cloudflare GraphQL `workersInvocationsAdaptive` 7 天采样）**：Blog 8,257、Images 92、Zboard 20,090、Tavern 1,830（合计 30,269 次请求，外推月均约 13 万请求、17–20 万条基础日志、~1,800 trace spans；按每条 1–3 KB 估算约 0.2–0.7 GB/月摄入、0.05–0.17 GB-month 存储；不含 AI/WeChat 后续流量与账户其他应用）。
- **官方定价（2026-10-29 核对）**：2026-11-30 前 Free 20 万条/日（保留 3 天）、Paid 2,000 万条/月（超额 \$0.60/百万条）；2026-12-01 起 Free 0.5 GB/日（保留 7 天）、Paid 50 GB 摄入 + 10 GB-month 存储（超额 \$0.25/GB、\$0.10/GB-month）。按上述基线预计不产生额外原生日志费用。
- 参考：[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)、[Traces](https://developers.cloudflare.com/workers/observability/traces/)、[Observability 定价](https://developers.cloudflare.com/observability/pricing/)、[最佳实践](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)。

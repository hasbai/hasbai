# Tavern Agent 与会话一致性

适用于 `apps/tavern/worker/agent.ts`、`session-object.ts`、`session-store.ts`、检索与上下文模块。Director 与候选契约见 [MODELS](MODELS.md#正文结束后的-director-agent)，发布证据与差异见 [PROGRESS](PROGRESS.md)，旧试验见 [history/AGENT-ITERATIONS](history/AGENT-ITERATIONS.md)。

## 状态与工具

Telegram 与浏览器共用会话入口（[MESSAGING](MESSAGING.md)）。每个 assistant 版本保存 before/after 状态与工具步骤：

- **状态字段**：`scene`、`facts`、`relationships`、`inventory`（有界 JSON patch，省略保留、`null` 删除，白名单/深度/字节有界）及 `goals`（最多 16 项，记录跟进事项、`owner` 区分 `character`/`player` 不可跨键改变、`active`/`paused`/`completed`、`pauseReason`、`completionEvidence` 须逐字引用已完成动作或结果，其中 `player` 证据仅取自用户原文；普通闲聊不建目标，旧快照补空 `goals`，回顾不算恢复，已完成不重启）。
- **事务提交**：`update_state` 仅在轮内暂存；只有正文正常完成且未停止，才与消息、快照及 revision 在 DO 同事务提交（长度中断、停止、断流或工具失败不提交）。
- **线性历史**：编辑/删除与重生成均在当前会话截断后续消息（不建分支，编辑不自动推理），同事务失效目标及后续工具记录、草稿、投影与检索索引；受影响的摘要清除后按剩余历史重建，旧 `requestId` 标记取消。

| 工具 | 输入与输出 | 约束 |
| --- | --- | --- |
| `search_memory` | `query:string` → 最多 3 条片段 `id,text,source` | 只查本人当前会话成功剧情与启用世界书 |
| `read_memory` | `id, offset` → 原文页、`source`、`total`、`nextOffset` | 仅接受本轮检索返回的 ID，从 0 按 `nextOffset` 读取 |
| `update_state` | `patch:object` → 暂存或字段错误 | 不接受未来候选，不直接提交 |

整批调用先校验非法字段、重复与批内重复再按序执行；不接受 URL/SQL/owner/session 参数，返回内容为数据（不改 system 或权限）。上游原生工具增量中顶层 `tool_calls:null` 等同未提供；可空协议字段（ID/type/function/name/arguments）为 `null` 不覆盖累计值，保留 `index` 校验且不递归清洗业务 patch。

## 检索与原文

- DO 成功消息与状态为权威剧情；摘要、投影、分块与向量均为可重建派生数据，不改写私人原文。
- 历史分块绑定成功消息 ID 与内容 hash，世界书绑定 book/entry/revision，索引存当前会话 DO（每次最多补 8 块向量，10 秒渐进补齐；`@cf/baai/bge-m3` 经统一 AI Worker 调用，不可用时回退关键词）。
- 合并召回优先原关键词与成功版本：双源命中取最新历史 2 条 + 最优世界书 1 条（缺位互补）；按 `id + source` 去重，`id + source + text` 判定回合检索进展（同 query 拒绝，重复结果停止）。长消息以最长命中词映射 Unicode 字符取前 100 / 总 600 字符窗口（中文二元词按 Unicode 字符生成）；`read_memory` 每页最多 1200 Unicode 字符，直接读取当前有效版本或快照原文。

## Prompt 与模型投影

- 正文、Director、压缩与角色生成经 `worker/inference.ts` 调用固定 catalog 版本的 Vercel AI SDK `streamText`（`tool` 不设 `execute`、`maxRetries:0`、`streamRetries:0`，保留原始请求、工具顺序、usage/timings 与 HTTP 日志 ID；不引入 Cloudflare Agents SDK）。
- **提示词与消息结构**：应用提示词见[应用提示词](ARCHITECTURE.md#应用提示词)；角色宏见[角色卡与世界书](ARCHITECTURE.md#角色卡与世界书)。首条 `system` 含用户提示、角色卡、世界书与工具指导，其后依次为已校验 checkpoint、完整近期剧情、当前确认 `state`（空则省略，纯数据不加指令）及末尾用户本轮原文。
- 跨轮模型投影从有效剧情与已校验 checkpoint 重建（格式版本或来源指纹变更即失效）；不保存 wire 中的旧 state、提醒或协议片段。Telegram 入站按 `username: content` 格式化（OOC 控制行保持独立）；progress RPC 仅按 owner/session/requestId 返回持久草稿。
- 同轮保留真实 `tool_calls` 与结果（不加假 user 提醒）。正文 `length` 或输出检查失败保留实际内容并报错，不自动续写或修订；Director 复用本轮真实 wire，不把阶段任务写入正文记忆。

## 正文流式展示与检查

- 正文增量即时 SSE 透传（外层不逐块执行 JS），私有 `generation_drafts` 存恢复检查点（pending GET 不暴露草稿）。浏览器断连只关闭展示流，DO 后台继续续租并保存终态；显式停止先持久取消标记再中止上游，刷新或重连按 `generationId` / 相同 `requestId` 幂等回放（HTTP 429 记为 `rate_limited`）。
- 可靠 `stop` 后检查 `think` 标记、同轮长段重复与最近 3 轮跨轮精确复写（至少 2 段各 ≥ 60 字且占新稿 ≥ 45% 判复写；明确回顾/总结豁免，否定不豁免）。失败返回 `invalid_output` 保留原稿；停止/中断/故障保留部分输出且不提交暂存 state 或候选，最终消息写入、state 提交与检查点清理同事务完成（`continue:true` 返回 400）。

## 执行记录与命令

`agent_activities` 保存 Director、工具、压缩与状态记录并通过 SSE 推送（不等待客户端阻塞收尾）；重启将未完成标为中断，不自动重推。`/status` 与 `/compress` 按 `ordinal` 插入消息流（独立 `requestId`，不建角色消息；压缩仅在成功时提交 checkpoint）。`OOC` 行作为用户控制指令进入模型，排除出状态证据、检索与摘要。

## 上下文与摘要

- 不设固定 32K/12K 目标、`maxTokens`、正文长度或整轮 deadline；容量取自 AI 平台目录 `context_tokens` 及上游反馈下调（缓存 1 小时，不再探测 `/props`），未知容量保留全部有效历史。字符估算带倍率与 256 tokens 模板开销，不预扣输出额度。
- 仅在超过已发现容量或上游报错超限时触发自动压缩（手动 `/compress` 共用算法）：保留核心卡片与本轮待答输入，将已有摘要与未压缩历史合成为新 checkpoint（绑定消息 ID/版本/指纹，不删原文与导出；请求保留 user/assistant 角色并在末尾追加一条 user 压缩任务，无 system 指令；输出 `length` 直接报错）。正文无输出时遇超限可压缩后重试，已有部分输出则直接结束。180 秒持续续租仅用于故障恢复。

## DO与迁移一致性

- Worker 验签后按 `owner + session` 路由每会话 SQLite DO（D1 存目录/角色/世界书/设置/旧迁移来源，R2 存私有原件）。惰性迁移在 D1 原子设 `storage_backend=do` 与永久 `generation_id=do:<sessionId>` 哨兵后逐字段导入 DO（失败留来源重试，0007/0008 兼容）；切换后只写 DO 并通过 `revision`/`synced_revision` 与 alarm 幂等同步 D1 目录。
- **删除契约**：先持久标记清理意图与重试 alarm，确认 D1 删除标记并释放绑定后 `await deleteAll` 清空 SQLite 与 alarm 再返回（生成或收尾中拒绝删除；构造函数不建表，已删除对象旧请求不可重建或复活，参考 [SQLite deleteAll](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#deleteall)）。
- **并发与中止**：初始化消息与 before 快照同事务；模型 `await` 期间不持有 `blockConcurrencyWhile` 以允许 `stop`。停流优先释放等待背压写入，先存终态释放占用再入队最多 `error`/`done` 两帧。兼容日期 `2026-10-03`（支持标准 `TransformStream` 与 DO `waitUntil` 保活规则）。

## 长程与缓存评测

固定 15 轮 + 切会话/分支/重生成/停止场景在 `scripts/agent-evaluation-cases.mjs`；在应用目录设 `AI_ACCESS_TOKEN` 运行 `pnpm eval:agent`（经 `ai.hasbai.xyz`，`--ref <commit>` 支持隔离对照，输出存 `.local-visual/agent-evaluation/`）。逐请求记录 `cached_tokens`、prefill/decode、首字时间与漏召回嵌入对照（前缀相同不等于真实 GPU 命中）。

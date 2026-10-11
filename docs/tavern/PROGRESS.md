# Tavern 当前状态与验收差异

按当前 main 的实现及已保存证据整理；自动化、合并、自动部署与真实模型分别认定。历史成功不能证明切换模型调用入口后的行为已全部验收。

## 本次生成链路优化

正文完成后，Director 复用最后一次正文请求前缀与工具 schema，追加新正文及末尾 user 任务；普通长会话取消逐轮梗概，摘要只在超限压缩时调用。用户消息不再拼接正文提醒，旧格式模型投影自动失效，原始历史不改写。

固定 compat/chat/completions HTTP 入口保存 Gateway 聚合响应与 streamed_data，并关联 eventId；专用推理 Secret 只存在服务端。旧 universal 绑定在隔离线上探针真实返回 400，直接 HTTP 入口在 workerd 要求 redirect:manual，均已修正。

2026-10-11 本地检查：231 项单测、类型检查、生产构建、隔离 D1 迁移、真实 workerd/SQLite 及视觉清单通过；本次没有页面样式变更。隔离线上正文/Director 成功，完整聚合响应、三项 metadata 与 eventId 已核对。此时 dynamic/rp 主节点为 custom-pc/qwen3.8-27b、备用为 Gemma；本地 /v1/models 返回 502，探针实际回退 Gemma，cached tokens 为 0，不能认定本地 27B 缓存通过。[PR #66](https://github.com/hasbai/hasbai/pull/66) 的八项必需状态全部通过，squash 为 `99ed8a29536ab166582991960cd70c9639071145`；自动 Build `fd6fad89-69d2-47e0-9662-928ab29483a` 成功，生产版本 `954a41a1-f734-44b3-b856-cb0297e84853` 流量100%，health 200且版本一致。

本人真实 JWT 的连续三轮、重生成、停止和续写均通过，正文/三候选/刷新/原 UUID 回放一致；五个成功回合逐项核对 Gateway 实际正文与 Director 共两次调用、消息前缀和 tools 恒等、用户输入无附加提醒、聚合正文与 streamed_data 拼接及持久正文一致、eventId 和三项 metadata 正确。临时角色和会话均删除，全局设置未改。此次实际均为 Gemma，普通正文及 Director cached tokens 为0；续写正文一次为64，不能外推至27B。合并、CI、部署和本地忽略验收目录 `apps/tavern/.local-visual/prefix-director` 分别留有证据。

## Director 本地模型兼容修复（2026-10-12）

线上最新同回合日志显示正文为 custom-pc/Qwen，Director 为 Google Gemma 4（不是 OpenAI GPT-4）。当前 RP 路由主节点为本地 Qwen、备用为 Gemma，无条件分流。直接重放 Director 请求，本地返回 HTTP 500 / Jinja `System message must be at the beginning.`；仅将末尾 Director 任务改为 user 后，本地返回 200、可靠 stop 和三条有效候选，strict JSON Schema 与工具定义保持不变。代码对正常及按需压缩路径共用此兼容任务；不改写原始正文前缀和用户剧情。

用户决定日志暂不改：Gateway 当前保存完整聚合响应及 streamed_data；公开日志设置没有仅去掉分段的开关，日志 PATCH 也不支持替换 response。浏览器实时出字和现有日志保留。

本节为根因与直接上游重放证据；本次应用部署及持久化验收待补，不将直接上游成功视作生产应用已发布。

## 已实现

角色卡/世界书导入导出、Chub/TheatreLM 搜卡安装、持久会话与版本、流式正文/停止/续写/重生成/分支；每会话 DO、状态事务、原生工具、来源检索、世界书混合召回、正文投影及超限摘要；正文前缀复用与 Director 三候选。

存储故障恢复、SSE 背压停止、删除清空/防复活已实现。此前调用入口为原生 AI.run；本次改为固定 Gateway compat HTTP。顶层空工具增量和可选工具分片的 null 兼容修复分别合入 PR #62 / #63；不再将 #63 标为代码“待发布”。

## 最近证据与未解决差异

| 层级 | 已有证据 | 仍需核验 |
| --- | --- | --- |
| 存储、停止、删除 | [Agent 修复历史](history/AGENT-ITERATIONS.md)记录真实 workerd/SQLite 故障注入、原 UUID、重启与清空；模型是夹具 | 不把夹具当生产模型或线上故障注入 |
| 原生入口普通正文 | #62 已记录自动 Build/100%版本/health；真实普通回复、三候选、停止及显式续写的保存/刷新/回放一致 | 不由普通正文成功推断所有工具回合成功 |
| 可选工具分片 | #63 (`85e78cc`) 已在 main，已有单元、workerd 和固定 Linux 证据 | 现有历史仍停在提交前记录，未补完整 #63 的 PR/自动部署与真实工具回合验收，不能补写通过 |
| Gateway 完整日志 | #62 的唯一输入/用户名样本核对到正文、Director、梗概完整 payload，三项 metadata 正确 | 此前原生日志 `event_id` 仍空；时间/内容匹配不能替代 requestId 事件关联，本次固定 HTTP 的本人应用五个成功回合已关联 eventId，并核对完整聚合响应，见上方证据 |
| 缓存与容量 | 旧入口有同轮 KV 命中和超限摘要样本；按发现窗口压缩已实现 | 跨轮缓存回退、上游容量探测及真实 TTFT 仍受上游影响，不承诺前缀稳定必然命中 |

旧 #61 的 HTTP/SSE 后零字失败由 #62 的 null 增量修复取代；#62 的真实工具失败不能被旧入口工具成功或 #63 夹具成功覆盖。待核验项只记录证据缺口，这些差异属于此前入口；本次探针与后续验收见上方。

完整阶段记录见[交付历史](history/DELIVERY.md)和[Agent 迭代](history/AGENT-ITERATIONS.md)；当前契约分别维护在[架构](ARCHITECTURE.md)、[AGENT](AGENT.md)、[MODELS](MODELS.md)。后续目标以 AGENT 为准。

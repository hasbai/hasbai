# Tavern 当前状态与验收差异

按当前 `main` 实现与已保存证据整理。自动化、合并、自动部署与真实模型分别认定，历史入口证据不得外推到变更后的新入口。

## 已实现

- **产品与存储**：已实现角色库与世界书导入导出、Chub 与 TheatreLM 搜卡安装、角色与图片 AI 生图及图床直连。也已实现线性历史编辑/删除/重生成、Telegram 消息中台接入与 Saki 切换。持久层包含每会话 SQLite DO、状态事务、`goals`、`search_memory`、`read_memory`、超限压缩与 DO 删除清空。
- **推理与提示词**：已接入 Cloudflare Agents SDK（`Lifecycle` + `PiHarness`）、`@earendil-works/pi-durable` 与 `@earendil-works/pi-ai`，经 `AI_SERVICE` 调用统一 AI Worker。正文支持实时流式透传（已修复 `exceededCpu`）与前缀复用加独立 `DirectorAgent` 三候选。KV `dialogue-v3` 可编辑应用提示词与关于页同步已落地。

## 关键实测与历史证据索引

- **提示词编辑与精简（2026-10-20）**：正文附加规则由 621 字减至 218 字。本地 376 项单测、类型、构建、隔离 D1、workerd 与 6 张关于页 Linux 截图通过。合并前 18 场景（`qwen38-27b`，温度 0.9）旧版完成 12/18、精简版完成 15/18。仍存在将恢复轮用户要求误作完成证据、短段复读与思考泄漏样本（结果存 `.local-visual/prompt-simplification-*-evaluation/results.json`）。
- **线性历史与连接中断修复（2026-10-16）**：外层 Worker 改原生透传（对照 2000 分块 CPU 从 619ms 降至 1ms）。断连后后台继续生成保存，HTTP 429 记 `rate_limited`。本地 325 项单测、隔离 D1、workerd 与四应用检查通过。
- **记忆原文、目标与固定长程评测（2026-10-15）**：固定 18 场景经 `gpt-6.1-sol` 全部完成。Director 前缀与 tools 18 次一致，`search_memory → read_memory` 读取更正原文，嵌入相似度 0.612 对 0.463。47 次请求中只部分正文首请求与工具续轮命中缓存，18 次 Director 命中均为 0。残余 1 条完成态与 `facts` 文本矛盾（证据在 `.local-visual/agent-evaluation/`）。
- **AI SDK 与早期迭代（2026-10-11 至 2026-10-15）**：SDK 链路 4 请求完成样本（首字 14.245s、整轮 19.921s）。PR #66（`99ed8a2`）与 PR #67（`9a7fb4a`）已合入。两者验证普通正文与 Director 末尾 `user` 任务在 `custom-pc/qwen3.8-27b` 的前缀复用与真实缓存命中（657–814 tokens）。更早迭代、试验数据与交付记录分别归档于 [交付历史](history/DELIVERY.md)、[Agent 迭代](history/AGENT-ITERATIONS.md) 与 [候选试验](history/CANDIDATE-EXPERIMENT.md)。

## 仍需核验的差异

| 层级 | 已有证据 | 仍需核验 |
| --- | --- | --- |
| 存储、停止、删除 | 真实 workerd 与 SQLite 故障注入、原 UUID、重启与清空（模型为夹具） | 不得把夹具当作生产模型或线上故障注入。 |
| 统一 AI Worker 入口 | 目录接入与隔离运行时检查已实现 | 切换 `AI_SERVICE` 后的真实工具回合、超限压缩与 `dialogue-v3` 端到端真实模型验收。 |
| 缓存与容量 | 部分单卡首请求与工具续轮有真实 KV 命中样本 | 跨轮缓存回退、模型目录 `context_tokens` 超限压缩与真实 TTFT 受上游影响，不承诺必命中。 |
| 工具分片与旧 #61/#63 | #63（`85e78cc`）已合入并有单元、workerd 与 Linux 证据 | 真实线上工具回合仍必须独立确认。 |

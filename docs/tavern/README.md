# Tavern · 酒馆开发入口

`apps/tavern`：私人角色扮演对话应用，Svelte 5 SPA / 共享 Luma / Worker `tavern` / D1 / 私有 R2 / KV / 每会话 SQLite DO。财务三表边界不适用，代码不改动其他应用数据。

## 业务边界

- 登录、JWT claims、`username` 与 audience 复用[共享 AUTHORIZATION](../AUTHORIZATION.md)（按 `sub` 隔离本人资源；`tavern.all:all` 仅用于全站敏感操作）。
- 对话模型目录经 `AI_SERVICE` 读取 AI 平台，客户端仅保存逻辑 ID；模型参数与候选见 [MODELS](MODELS.md)。
- 会话全由服务端持久化，不执行角色扩展脚本；不虚构推荐、评分、历史或候选。
- 公开角色目录固定 revision、完整校验、原子切换；上游失败明确报错。
- Gateway 保存完整请求与回复（含 `app`、`task`、`username` 三项 metadata）；当前证据缺口见 [PROGRESS](PROGRESS.md)。
- 会话删除必须清空对应 DO 全部存储与 alarm 后再返回；D1 删除标记阻止复活，详见 [DO 与迁移一致性](AGENT.md#do与迁移一致性)。

## 按任务读取

| 任务 | 文档 | 代码入口（相对 `apps/tavern`） |
| --- | --- | --- |
| 卡片、来源、UI、API 与资源 | [ARCHITECTURE](ARCHITECTURE.md) | `shared`、`worker/index.ts`、`worker/discovery.ts`、`src/pages` |
| Telegram、Saki 卡片、绑定与收发 | [MESSAGING](MESSAGING.md) | `worker/channels.ts`、`worker/message-inbox.ts`、`packages/messaging` |
| 状态、工具、检索、摘要、DO 一致性 | [AGENT](AGENT.md) | `worker/agent.ts`、`worker/session-object.ts`、`worker/session-store.ts` |
| 长程语义与实际缓存评测 | [评测入口](AGENT.md#长程与缓存评测) | `scripts/evaluate-agent.mjs`、`scripts/agent-evaluation-cases.mjs` |
| 正文流式响应、复读检查与恢复 | [流式契约](AGENT.md#正文流式展示与检查) | `worker/generation.ts`、`worker/narrative.ts` |
| 参数、模型白名单、独立 Director | [MODELS](MODELS.md) | `shared/settings.ts`、`worker/inference.ts`、`worker/gateway.ts`、`worker/director.ts` |
| 当前实现与未解决验收 | [PROGRESS](PROGRESS.md) | 当前 `main` 与逐层证据 |
| 交互图解 | [ARCHITECTURE.html](ARCHITECTURE.html) | 文档辅助图（非运行时证据） |
| 历史与排查 | [UI 排查](UI-AUDIT.md)、[交付历史](history/DELIVERY.md)、[Agent 演进](history/AGENT-ITERATIONS.md)、[候选试验](history/CANDIDATE-EXPERIMENT.md) | 历史证据 |

本地启动见 [AGENTS](../../AGENTS.md#先定位应用)；检查、隔离 D1/workerd、Linux 截图与交付统一见 [TESTING](../TESTING.md)。

## 同步维护

- 修改对话架构、上下文顺序、工具、状态或记忆机制时，必须在同一变更同步更新相关文档与 `src/pages/About.svelte`。
- 应用提示词存于 Cloudflare KV（默认在 `shared/instructions.ts` 与 `shared/prompts.ts`），运行请求与关于页面共用同一配置；新增字段须同步文档与页面用例，在线编辑规则见 [应用提示词](ARCHITECTURE.md#应用提示词)。
- 页面只保留功能标题、实际流程与必要说明，不加装饰性英文副标题、口号或自我解释横幅。

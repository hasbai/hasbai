# Tavern · 酒馆开发入口

`apps/tavern` 是私人角色扮演对话应用，Svelte 5 SPA / 共享 Luma / Worker `tavern` / D1 / 私有 R2 / KV / 每会话 SQLite DO。财务三表边界不适用，代码不改动其他应用数据。

## 业务边界

- 登录、公共 JWT claims、username 与 audience 复用[共享 AUTHORIZATION](../AUTHORIZATION.md)，不增加 Tavern audience 限定或专属用户名签发条件。业务接口以签名 sub 隔离本人资源；全站管理权限与本人功能的区别按该文档执行。
- 模型仅接受服务端白名单逻辑 ID，当前 RP 映射固定 AI Gateway `default` 的 `dynamic/rp`；不开放任意模型、路由、URL 或密钥。模型参数及候选见[MODELS](MODELS.md)。
- 全部会话由服务端持久化，角色扩展脚本不执行；不虚构推荐、评分、历史或候选，不把候选当已发生剧情。
- 公开角色目录固定 revision、完整校验、原子切换；上游失败明确报错，不能伪装搜索成功。
- Gateway 保存完整请求与回复，统一 `app`、`task`、`username` 三项 metadata。当前 eventId 的期望与线上证据缺口见[PROGRESS](PROGRESS.md)。
- 会话删除必须同时清理对应 DO 全部存储与 alarm，成功后才返回；D1 删除标记阻止旧来源复活，失败可重试，不永久保留 DO tombstone。构造函数及已删除对象的旧请求不能重建存储。完整约定在[删除与迁移一致性](AGENT.md#do与迁移一致性)。

## 按任务读取

| 任务 | 文档 | 代码入口（相对 `apps/tavern`） |
| --- | --- | --- |
| 卡片、来源、UI、API 与资源 | [ARCHITECTURE](ARCHITECTURE.md) | `shared`、`worker/index.ts`、`worker/discovery.ts`、`src/pages` |
| 状态、工具、检索、摘要、DO 恢复/删除 | [AGENT](AGENT.md) | `worker/agent.ts`、`worker/session-object.ts`、`worker/session-store.ts` |
| 正文流式响应、复读检查与恢复 | [流式契约](AGENT.md#正文流式展示与检查) | `worker/generation.ts`、`worker/narrative.ts` |
| 参数、模型白名单、独立 Director | [MODELS](MODELS.md) | `shared/settings.ts`、`worker/gateway.ts`、`worker/director.ts` |
| 当前实现与未解决验收 | [PROGRESS](PROGRESS.md) | 当前 main 与逐层证据 |
| 交互图解 | [ARCHITECTURE.html](ARCHITECTURE.html) | 文档辅助图，不是运行时或验收证据 |
| 决策与交付追溯 | [交付历史](history/DELIVERY.md)、[Agent 演进](history/AGENT-ITERATIONS.md)、[候选试验](history/CANDIDATE-EXPERIMENT.md) | 旧候选/预算/认证方案不作为当前契约 |

根 `pnpm dev:tavern` 启动 5176，API 在应用目录用 `pnpm exec wrangler dev --port 8787`；本地检查、隔离 D1/workerd、Linux 截图与子代理 PR/CI/squash 交付只在[共享 TESTING](../TESTING.md)维护。沿用 Workers Builds 自动部署。

## 同步维护

- 修改对话架构、上下文顺序、工具、状态或记忆机制时，同步相关文档与 `src/pages/About.svelte`。两者必须与代码在同一变更中交付。
- 应用提示词存于 Cloudflare KV，运行请求与关于页面读取同一配置。默认值在 `shared/instructions.ts` 与 `shared/prompts.ts`；增加字段时同步 KV 文档和页面用例。在线编辑规则见 [ARCHITECTURE](ARCHITECTURE.md#应用提示词)。
- 页面只保留功能标题、实际流程和必要说明，不添加装饰性英文副标题、口号或自我解释横幅。

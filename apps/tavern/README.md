# Tavern · 酒馆

私人角色扮演对话应用。功能包含角色卡与世界书、在线搜卡安装、持久会话、流式生成、停止、重新生成与编辑。模型请求固定经 AI 平台调用网关 `default`，对话模型由平台发现并由会话选择。

仓库根运行 `pnpm dev:tavern` 启动前端。本地 API 在本目录运行 `pnpm exec wrangler dev --port 8787`。独立 Worker、D1、私有 R2 与每会话 SQLite DO 共用北极小站登录。

开发前读 [边界与任务路由](../../docs/tavern/README.md)。产品、API 与角色来源见 [架构](../../docs/tavern/ARCHITECTURE.md)。状态、工具、恢复与删除见 [Agent 契约](../../docs/tavern/AGENT.md)。未解决的真实模型与日志验收见 [PROGRESS](../../docs/tavern/PROGRESS.md)。本地检查、Linux 截图、PR 与自动发布统一见 [TESTING](../../docs/TESTING.md)。

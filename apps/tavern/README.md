# Tavern · 酒馆

私人角色扮演对话：标准角色卡/世界书、在线搜卡安装、持久会话、流式生成、停止、重新生成与编辑分支。模型请求固定服务端 AI Gateway `default` / `dynamic/rp`。

仓库根 `pnpm dev:tavern` 启动前端；本地 API 在此目录 `pnpm exec wrangler dev --port 8787`。独立 Worker/D1/私有 R2 与每会话 SQLite DO，共用北极小站登录。

开发前读[边界与任务路由](../../docs/tavern/README.md)。产品/API/角色来源见[架构](../../docs/tavern/ARCHITECTURE.md)，状态/工具/恢复与删除见[Agent 契约](../../docs/tavern/AGENT.md)，当前未解决的真实模型/日志验收见[PROGRESS](../../docs/tavern/PROGRESS.md)。本地检查、Linux 截图、PR 和自动发布统一见[TESTING](../../docs/TESTING.md)。

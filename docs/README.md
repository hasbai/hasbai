# 文档导航

`README.md` 为公开全貌介绍，`AGENTS.md` 维护全局开发约束、环境命令与应用分流。此页按任务定位资料，避免通读整个文档目录。

## 共通文档

| 任务 | 唯一规则入口 | 依据 |
| --- | --- | --- |
| 了解应用、共享包、部署分工 | [ARCHITECTURE](ARCHITECTURE.md) | workspace、各应用 Wrangler 配置 |
| 登录、JWT、audience、用户与管理员权限 | [AUTHORIZATION](AUTHORIZATION.md) | `packages/auth`、`auth0/login-claims.js`、各 Worker |
| 共用组件、主题、交互和可访问性 | [DESIGN](DESIGN.md) | `packages/ui`、各应用设计契约 |
| Markdown、数学、图表、引用与源码保真 | [MARKDOWN](MARKDOWN.md) | `packages/markdown`、博客编辑器 |
| 日志、链路追踪、脱敏与用量 | [OBSERVABILITY](OBSERVABILITY.md) | 各应用 Wrangler 配置、`packages/observability` |
| 本地检查、截图、迁移、CI、提交发布 | [TESTING](TESTING.md) | package scripts、workflow |

## 应用文档

| 应用 | 开发入口 | 详细契约 |
| --- | --- | --- |
| Financial | [范围与任务路由](financial/README.md) | 架构、数据库/API、业务口径、页面设计、当前状态 |
| Blog | [范围与任务路由](blog/README.md) | SSR、内容模型、缓存、编辑与共享 Markdown |
| Zboard | [范围与任务路由](zboard/README.md) | 节点、订阅、模板、流量与 D1 |
| Images | [图床边界与 API](images/README.md) | 统一图片存储、管理、AI 生成与 API |
| AI | [AI 服务与模型目录](ai/README.md) | 模型发现、Provider/BYOK、动态路由与公共 API |
| WeChat | [微信 Bot 会话与 MCP](wechat/README.md) | iLink 接入、持久化会话、轮询与 MCP 工具 |
| Tavern | [范围与任务路由](tavern/README.md) | 架构、Agent/DO、模型与 Director、状态及图解 |

各应用的 `history/` 保存方案演进、迁移与历史验收证据，按需追溯；当前契约链接优先，历史文件不追加当前流程。

## 维护方式

维护流程见 [doc-maintenance](../skills/doc-maintenance/SKILL.md)。改写前先确定职责与归属，同一规则只维护一处；常用入口保留长期边界和当前行为，已完成阶段归档，状态文档只写能力、待核验项与证据入口。移动文件或标题后修正相对链接、锚点与代码注释入口，按[文档检查](TESTING.md#文档检查)校验。

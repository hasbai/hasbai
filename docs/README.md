# 文档导航

`README.md` 介绍用途和启动方式，`AGENTS.md` 维护全局开发约束与应用分流。此页按任务定位资料，避免日常开发通读整个文档目录。

## 共通文档

| 任务 | 唯一规则入口 | 依据 |
| --- | --- | --- |
| 了解应用、共享包、部署分工 | [ARCHITECTURE](ARCHITECTURE.md) | workspace、各应用 Wrangler 配置 |
| 登录、JWT、audience、用户与管理员权限 | [AUTHORIZATION](AUTHORIZATION.md) | `packages/auth`、`auth0/login-claims.js`、各 Worker |
| 共用组件、主题、交互和可访问性 | [DESIGN](DESIGN.md) | `packages/ui`，各应用设计契约 |
| Markdown、数学、图表、引用与源码保真 | [MARKDOWN](MARKDOWN.md) | `packages/markdown`、博客编辑器 |
| 日志、链路追踪、脱敏与用量 | [OBSERVABILITY](OBSERVABILITY.md) | 各应用 Wrangler 配置、共享日志包 |
| 本地检查、截图、迁移、CI、提交发布 | [TESTING](TESTING.md) | package scripts、workflow、`scripts/affected.mjs` |

## 应用文档

| 应用 | 开发入口 | 详细契约 |
| --- | --- | --- |
| Financial | [范围与任务路由](financial/README.md) | 架构、数据库/API、业务口径、页面设计、当前状态 |
| Blog | [范围与任务路由](blog/README.md) | SSR、内容模型、图片、编辑与共享 Markdown |
| Zboard | [范围与任务路由](zboard/README.md) | 节点、订阅、模板、流量与 D1 |
| Images | [范围与任务路由](images/README.md) | 统一图片存储、管理、AI 生成与 API |
| Tavern | [范围与任务路由](tavern/README.md) | 架构、Agent/DO、模型与 Director、当前状态及图解 |

每个应用的 `history/` 保存有价值的方案演进、迁移与验收证据，按需追溯。旧命令、旧权限、旧候选协议或一次实测只说明当时结果；当前契约链接优先，历史文件不追加当前流程。

## 维护方式

维护技能位于 [doc-maintenance](../skills/doc-maintenance/SKILL.md)，提供按需维护和 commit 增量审计流程。

新增或修改文档时，先确定职责及所属应用；同一规则只维护在上表或应用入口指定的文件。常用入口保留长期边界和当前行为，已完成阶段及过时清单归档。状态文档只写能力、待核验项和证据入口，不重复架构。

移动文件后修正 Markdown/HTML 相对链接、章节锚点及代码中的文档入口。核对命令的工作目录与 package script；以实现和用户明确决策区分已实现、待实现、已合并、已发布及已真实验收。纯文档交付按[TESTING](TESTING.md#文档检查)检查。

# Hasbai 项目指南

## 先定位应用

仓库历史名 `financial` 不代表任务属于财务。开始修改前读取目标应用入口，再按任务读取其中链接的契约；财务三表/schema/基表 DML 限制只适用于 Financial。

| 应用 | 代码工作目录 | 必读入口 |
| --- | --- | --- |
| 财务 / 北极账本 | `apps/financial` | [财务边界与路由](docs/financial/README.md) |
| 博客 / 北极小站 | `apps/blog` | [博客边界与路由](docs/blog/README.md) |
| Zboard | `apps/zboard` | [Zboard 边界与路由](docs/zboard/README.md) |
| 图床 / Images | `apps/images` | [图床边界与路由](docs/images/README.md) |
| 酒馆 / Tavern | `apps/tavern` | [Tavern 边界与路由](docs/tavern/README.md) |

目标目录缺失时，先核对 `git status --short --branch`、`git worktree list` 与最新 `origin/main` 目录树，复用包含目标应用的干净工作区。不为定位强行切换、重置或覆盖其他任务，不要求用户重发已存在的项目地址。机器专属路径不作为永久代码入口。

## 全局约束

- 修改用户内容前，先说明具体文案、位置和范围，并取得同意。问题描述、外部审核退回或合规建议不构成改稿授权；执行仅限确认范围。博客首页的已授权范围见[博客入口](docs/blog/README.md#内容修改边界)。
- 围绕确认需求选择直接、可维护的实现，不增加不必要的抽象、校验门槛或服务依赖，不预设计未授权能力。
- 通用能力统一放在 `packages`。优先复用 `packages/ui`；现有可复用组件先共享再引用，避免各应用重复通知、表单、弹层和认证能力。共享视觉与交互见[DESIGN](docs/DESIGN.md)。
- 登录统一使用 `packages/auth`、`auth.hasbai.xyz` 的 Auth0 Universal Login，提供邮箱、Google、Microsoft Account、GitHub；不得按应用强制单一连接。各 API audience、用户与管理权限的唯一规则入口是[AUTHORIZATION](docs/AUTHORIZATION.md)。
- 凭据文件只通过程序化读取用于已授权请求；禁止用 `cat`、`rg`、`sed` 回显配置值，禁止输出完整环境、认证头、令牌或管理 API 响应。诊断与子代理交付仅输出选定的状态、资源 ID、构建 SHA 等非敏感元数据。浏览器只含公开配置和用户会话凭据，存储方式按[AUTHORIZATION](docs/AUTHORIZATION.md)。

## 校验与交付

环境摘要运行 `node scripts/local-environment.mjs info`；依赖准备和快捷操作见 [Codex 本地环境](README.md#codex-本地环境)。
云环境的 x86_64 本地开发使用 `node scripts/cloud-dev.mjs run <命令>`，复用 CI 的版本与配置。ARM CI 和截图基线流程保持不变。

修改前按[TESTING](docs/TESTING.md)确认本地检查、截图、迁移与交付路径。该文档统一维护必需状态、CI 等待、子代理发布、squash 合并、允许直推和自动部署核验规则，应用文档不重复流程。

必要的隔离验证、生产迁移、真实 API 核验、提交和推送属于同一次已授权交付，不另等发布授权；涉及兼容迁移时不能只交付前端。

## 文档维护

[doc-maintenance](skills/doc-maintenance/SKILL.md) 规定 STE100 精简、审校和程序校验流程，[文档导航](docs/README.md)定义文档职责。共通规则只维护一处，应用细节就近放置，其他位置链接引用。当前实现、目标要求与历史证据分别标注；提交标题仅作线索，依据代码、配置、测试和用户决策核对。普通任务只读相关文档，不把历史目录当当前规范。

Tavern 对话架构变更必须同步相关文档和关于页面，规则见[酒馆入口](docs/tavern/README.md#同步维护)。

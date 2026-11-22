# Hasbai · 北极小站

这里是 **Hasbai（北极小站）** 的个人应用集合。

本集合围绕统一账号、共享界面与边缘架构，提供日常使用的 Web 应用与对话服务。

## 应用全貌

| 应用 | 入口 | 定位与核心能力 |
| --- | --- | --- |
| **北极小站 · Blog** | [hasbai.xyz](https://hasbai.xyz) | 公开文章、手记、时间线与独立页面。支持多语言阅读、扩展 Markdown 阅读与在线编辑发布。 |
| **北极账本 · Financial** | [financial.hasbai.xyz](https://financial.hasbai.xyz) | 个人复式记账与财务管理。覆盖资产负债、现金流、损益分析、流水补录、同笔退款与科目管理。 |
| **酒馆 · Tavern** | [tavern.hasbai.xyz](https://tavern.hasbai.xyz) | 私人角色扮演对话空间。支持角色卡与世界书、在线搜卡、持久会话、记忆检索与 Telegram 同步。 |
| **图床 · Images** | [images.hasbai.xyz](https://images.hasbai.xyz) | 统一图片托管与素材中心。支持原图上传、全局去重、多尺寸格式转换与 AI 生图。 |
| **AI 统一模型服务** | [ai.hasbai.xyz](https://ai.hasbai.xyz) | 统一大模型调用入口与对话工作台。支持自定义 Provider、BYOK 密钥与动态路由管理。 |
| **微信 Bot · WeChat** | — | 持久化微信对话接入与 MCP 工具服务。支持扫码接入、增量消息收发与会话管理。 |
| **Zboard** | — | 代理节点、用户配额、订阅与分流模板管理平台。 |

## 共享底座

- **统一身份认证**：基于 Auth0 Universal Login（`auth.hasbai.xyz`）提供邮箱、Google、Microsoft 与 GitHub 登录。各服务间保持细粒度权限隔离。
- **一致界面体验**：前端共享 Svelte 5 与 Luma UI 组件体系。界面兼顾桌面与移动端交互、深浅色主题与无障碍访问。
- **边缘云原生架构**：服务运行于 Cloudflare Workers 边缘网络。数据与推理结合 Durable Objects、D1、R2、Neon PostgreSQL 与 Cloudflare AI Gateway。

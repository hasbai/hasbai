# Zboard 开发入口

`apps/zboard`：Svelte 5 SPA / 共享 Luma neutral / Worker `zboard` / D1，负责代理节点、用户资格、模板、订阅与 Node API（财务三表/Neon 限制不适用）。

## 用户确认的边界

- 引入 monorepo 时无历史线上数据；首次 Auth0 登录创建禁用用户，由管理员启用并分配节点/权限，不关联旧账户或自建登录。
- 登录共用 `packages/auth` 并保留独立 Zboard API audience（见 [AUTHORIZATION](../AUTHORIZATION.md)）；`email` 仅展示，不用于关联或授权，面板不授予 Auth0 管理员角色。
- 复用既有 Worker/D1 资源，不运行外部 seed。零流量不写 D1，GET 轮询不写心跳，不伪造节点在线状态。
- 服务端配置与订阅公开参数分离，订阅只序列化白名单，REALITY 私钥不进入订阅，不生成虚假可用节点；节点连通、代理下载与真实客户端导入须独立核验。

## 按任务读取

| 任务 | 入口（源码路径相对 `apps/zboard`） |
| --- | --- |
| 节点、用户、Node API、订阅与模板契约 | [ARCHITECTURE](ARCHITECTURE.md)；`worker`、`shared/clash-preset.ts` |
| 功能与本地启动 | [应用 README](../../apps/zboard/README.md) |
| 原生 Mihomo、隔离 D1、Linux 截图、PR 与发布 | [共享 TESTING](../TESTING.md)；`visual-coverage.json`、`.github/workflows/zboard.yml` |

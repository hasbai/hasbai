# Zboard

代理节点、用户资格与订阅管理，基于 Svelte 5 SPA、共享 Luma UI 与 Auth0、Worker 与 D1。首次登录创建禁用账户，管理员启用并分配节点。

- **管理**：总览、节点、JSON 模板与变量、用户启停、配额、到期、分配与最近报告。
- **用户**：本人用量、有效期与节点，URI、Base64 与 Clash/Mihomo 订阅，凭据轮换。
- **Node API**：兼容 XrayR NewV2board 的 `config`、`user` 与 `push`。正流量累计并写报告，全零不落库。

## 本地运行

仓库根运行 `pnpm install --frozen-lockfile` 与 `pnpm dev:zboard`。API 在本目录运行 `pnpm exec wrangler dev --port 8787`，前端通过 Vite 代理。

开发前读 [Zboard 边界与路由](../../docs/zboard/README.md)，业务与发布入口见 [架构](../../docs/zboard/ARCHITECTURE.md)，本地检查与交付见 [TESTING](../../docs/TESTING.md)。

## Clash/Mihomo 内置分流模板

完整订阅策略、规则来源与许可、DNS、覆盖项合并与旧默认兼容的唯一说明在 [模板契约](../../docs/zboard/ARCHITECTURE.md#clashmihomo-内置分流模板)。URI 与 Base64 只提供节点列表。规则与节点实际可用性必须另行验证。

# Zboard 架构与业务契约

开发边界见[README](README.md)，授权见[AUTHORIZATION](../AUTHORIZATION.md)；源码与迁移路径相对 `apps/zboard`，共享检查与交付见[TESTING](../TESTING.md)。

## 数据与协议

- **Worker 与 D1**：Worker 验证独立 audience JWT（以 `sub` 查本人，首次登录建禁用账户），静态资源为 Svelte SPA。管理员管理节点、JSON/Clash 模板、用户启停/配额（字节存储，GB 按 1024³ 换算，0 为不限）/UTC 到期/节点分配与最近 100 条报告。订阅随机凭据仅向本人返回，轮换后旧凭据失效，过期/停用/超额或无有效节点返回 404。D1 沿用原五张表（0002 留空、0003 清理 demo）。
- **Node API**：兼容 XrayR NewV2board `/api/v1/server/UniProxy/config|user|push`（独立 Node token）。正流量单批次累计并写报告（无幂等标识，不承诺精确一次），全零不落库，GET 不写心跳。同步按钮递增 `revision` 等待节点轮询（XrayR 对空用户列表有缓存局限，立即全停须停服节点）。

## Clash/Mihomo 内置分流模板

- `format=clash` 输出完整 Mihomo YAML：基础组（节点选择、自动测速、故障转移、广告拦截、国内直连、漏网之鱼）与服务组（AI、YouTube、Netflix、Disney+、Spotify、哔哩哔哩、Telegram、社交平台、GitHub、Google、微软、苹果、游戏）。国内游戏/CDN、苹果与微软中国域优先直连；国内规则先于海外大类，海外代理域名先于中国 IP；广告默认 REJECT，微软/苹果/哔哩哔哩默认 DIRECT，其余海外服务走节点选择。
- **规则与 DNS**：引用 [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat)（[GPL-3.0](https://github.com/MetaCubeX/meta-rules-dat/blob/master/LICENSE)）`meta/geo/geosite` 与 `geoip` YAML，客户端按 `rule-providers` 每 86400 秒更新（不随仓库复制全文或由 Worker 下载）。结构参考 [Xboard 默认配置](https://github.com/cedar2025/Xboard/blob/master/resources/rules/default.clash.yaml)，遵循 [Mihomo rule-providers](https://wiki.metacubex.one/en/config/rule-providers/) 与 [DNS](https://wiki.metacubex.one/en/config/dns/) 文档：规则下载走“节点选择”，节点域名用国内 DoH 解析，海外域名用经代理 DoH，不自动开启 TUN 或占用 53 端口（首次导入需真实节点连通规则源）。
- **模板编辑与兼容**：`clash_settings` 独立于节点 JSON 模板保存 YAML 与覆盖项；“载入内置分流模板”只替换编辑区并保留覆盖项，保存才写 D1。未改动且覆盖项为空的旧默认在读取/生成时自动使用新模板；`{{本站节点}}` 在策略组 `proxies` 展开为当前用户节点。JSON 模板中完整 `{{var}}` 按原始 JSON 类型替换，嵌入字符串自动转义，缺变量拒绝载入。
- **校验范围**：CI 使用 `docker/visual-ci/Dockerfile` 固定的 Mihomo 下载全部规则做 `convert-ruleset` 与本地 `-t` 语法检查，不替代真实节点连通与客户端导入验证。URI/Base64 仅输出节点列表。

## 节点与构建边界

- 服务端 JSON 与订阅公开参数分离，订阅仅输出白名单（VMess/VLESS/Trojan/Shadowsocks AEAD TCP），REALITY 私钥不进入订阅；面板不生成虚假节点。设备上限仅按原协议提供字段。
- 本地启动见 [AGENTS](../../AGENTS.md#先定位应用)；Auth0 配置在应用目录运行 `node scripts/setup-auth0.mjs`。Workers Builds 从仓库根运行 `pnpm --filter zboard build` 发布至 `zboard.hasbai.xyz`（交付时回读 Build SHA 与 `/health`）。

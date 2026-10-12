# Zboard 架构与业务契约

开发范围和硬性边界见[README](README.md)，授权见[AUTHORIZATION](../AUTHORIZATION.md)。源码/脚本/迁移路径相对 `apps/zboard`；本页维护应用业务规则，共享测试与交付流程以[TESTING](../TESTING.md)为准。

## 数据与协议

Worker 负责 JWT、D1、管理员节点/用户/模板/报告 API，静态资源为 Svelte SPA。首次登录创建禁用用户，管理员分配节点、配额与有效期。订阅随机凭据只向本人返回，过期/停用/额度用尽即时拒绝；支持 URI/Base64 与完整 Clash/Mihomo YAML，链接轮换使旧凭据失效。

Node API 保留 XrayR NewV2board `/api/v1/server/UniProxy/config|user|push`，Node token 与 Auth0 分开。正流量单批次更新累计并写报告，全零不落库，GET 不写心跳。D1 使用既有表；0002 保留迁移名但不写测试数据，0003 删除原 demo 用户并停用 demo 节点，不导入旧账号。

## Clash/Mihomo 内置分流模板

`format=clash` 返回完整的 Mihomo YAML。默认基础策略组为节点选择、自动测速、故障转移、广告拦截、国内直连和兜底。服务策略组包括 AI、YouTube、Netflix、Disney+、Spotify、哔哩哔哩、Telegram。

另有社交平台、GitHub、Google、微软、苹果和游戏组。国内游戏/CDN、苹果和微软中国域名优先直连；国内服务分类先于海外大类，海外代理域名先于中国 IP，最终未匹配流量交给“漏网之鱼”。广告默认 REJECT，可在客户端切换 DIRECT。微软、苹果、哔哩哔哩默认 DIRECT，其余海外服务默认走节点选择。

规则数据来自 [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) 的 `meta/geo/geosite` 域名 YAML 与 `meta/geo/geoip` IP YAML，客户端按 `rule-providers` 每 86400 秒更新和本地缓存；不在 Worker 请求中下载、不把上游规则全文复制入仓库。上游数据许可为 [GPL-3.0](https://github.com/MetaCubeX/meta-rules-dat/blob/master/LICENSE)，其 README 记录各数据源。模板结构参考 [Xboard 默认配置](https://github.com/cedar2025/Xboard/blob/master/resources/rules/default.clash.yaml) 的动态节点、测速与故障转移做法；本站策略及规则编排单独实现。规则匹配和下载字段遵循 [Mihomo rule-providers](https://wiki.metacubex.one/en/config/rule-providers/) 与 [DNS](https://wiki.metacubex.one/en/config/dns/) 文档。

规则下载明确走“节点选择”；节点域名用国内 DoH 独立解析，DNS 服务域名有 IP bootstrap；海外域名使用经代理的 DoH，国内规则走国内 DoH。启动不依赖 GeoIP/GeoSite 数据库，不自动开启 TUN 或占用本地 53 端口。首次导入仍需要本站真实节点可连通并允许访问公共规则源，之后有本地缓存；不承诺节点或外部服务可用性。

仅适用于支持上述字段的 Clash Meta/Mihomo 客户端，原生校验使用 workflow 固定版本和 SHA-256，安装/执行要求见[TESTING](../TESTING.md#运行)。CI 下载全部实际 YAML 规则，检查 payload，并逐项执行原生 `convert-ruleset` 校验 domain/ipcidr 内容；另以本地文件 provider 调用原生 `-t` 验证完整配置语法与各节点类型兼容。这不证明真实节点连接、规则通过代理下载或特定客户端版本的实际导入。URI/Base64 继续仅提供节点列表。

“载入内置分流模板”只替换当前 YAML 编辑内容，保留覆盖项，保存才写 D1。已保存的旧默认仅在文本与旧版完全一致（忽略首尾空白）且覆盖项为空时于读取/生成阶段使用新模板；不改写数据库，自定义 YAML 和带覆盖项的旧模板保留。`{{本站节点}}` 可用于策略组的 `proxies` 数组，合并覆盖项后展开为当前订阅用户的节点名，自动测速和故障转移仅测试这些节点；“本站节点”组仍在最后由系统生成。无分配/有效节点时订阅返回 404。

## 节点与配置边界

JWT/audience/管理员权限的签发与验签规则见[AUTHORIZATION](../AUTHORIZATION.md)。Worker 以签名 sub 查本人，首次访问创建禁用账户，后续读取不重复写入；email 仅展示，不能用于旧账户关联。服务资格、订阅凭据和 Node token 是独立业务协议，不由登录成功替代。

节点服务端 JSON 和订阅公开参数分别存储，订阅序列化仅使用白名单；REALITY 私钥仅存在管理员配置，不出现在订阅。节点地址、端口、SNI、公钥等由管理员据真实节点填写；面板不生成虚假的可用节点。VMess/VLESS/Trojan/Shadowsocks 支持常规 TCP/WS/gRPC 参数，Shadowsocks 仅标准 AEAD TCP。

Clash 格式为 YAML；模板与覆盖项存于独立 `clash_settings` 表，与节点协议 JSON 模板分开。配额以字节存储，GB 输入换算 1024³；额度 0 为不限。到期编辑明确使用 UTC。设备上限仅按原节点协议提供字段，官方 NewV2board 可能使用本机 override。

模板是可复制的配置快照；编辑模板不自动修改节点。载入模板只修改当前编辑器，保存才写入。JSON 中完整的 `{{var}}` 字符串按变量原始 JSON 类型替换，嵌入字符串的变量会正确转义；未提供变量拒绝载入。JSON 有效不等于所有 XrayR 协议字段有效，节点运行配置仍需按实际部署填写。

同步按钮递增 revision，代表等待节点下次轮询；不表示节点已经应用。XrayR 官方 NewV2board 对空用户列表有既有局限。停用最后一个用户后节点可能保留缓存；立即撤销全部代理服务须在节点端停服。

未改变上游 XrayR。流量协议无幂等标识，响应不明确的重试可能重复累加；不承诺精确一次。报告页面最近100条，全零请求无报告，不伪造在线状态。D1 使用原五张表，未增加每日汇总或心跳写入；原始报告尚未自动清理。

自动测试 fixture 独立于生产入口，生产无认证绕过。UI 组件用真实生产 CSS 验收；模拟设备不代表 iOS 真机或实际代理链路验收。


## 本地与自动构建

根 `pnpm dev:zboard` 启动 5175；应用目录 `pnpm exec wrangler dev --port 8787` 提供 API，Vite 代理请求。Auth0 setup 在应用目录 `node scripts/setup-auth0.mjs`，只扩展共享 SPA origins、独立 audience 和统一 Action，保留其他应用授权。

Workers Builds 连接 `hasbai/hasbai` / main，root `/`、build `pnpm --filter zboard build`，域名 `zboard.hasbai.xyz`。沿用现有 Worker/D1，交付回读自动 Build/线上 `/health` version；生产迁移只应用本应用迁移，不运行外部 seed。原生 Mihomo/规则内容、隔离 D1、本地全量非浏览器检查与 Linux 视觉要求统一在 TESTING 维护。

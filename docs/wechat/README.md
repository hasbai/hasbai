# WeChat · 微信 Bot 会话服务

`apps/wechat` 是无界面 Worker，域名 `wechat.hasbai.xyz`。它按 [openclaw-weixin 协议摘要](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md)接入 iLink Bot，持久保存会话，并通过 MCP 提供工具。
该协议摘要描述客户端行为，不是已验证的服务端契约。字段按可选处理，真实行为以首次联调为准。

## 身份与权限

MCP 入口 `POST /mcp` 验证共享 audience 的用户 JWT，并要求原生权限 `wechat.all:all`（仅授予既有 `superadmin`）。规则见 [AUTHORIZATION](../AUTHORIZATION.md)。
数据按 Auth0 `sub` 隔离：每个用户一个 Durable Object，工具不接受 owner 参数。
`GET /health` 匿名可用，其余路径返回 404。

## 持久化

每个用户一个 SQLite Durable Object `WechatOwner`，保存：

| 表 | 内容 |
| --- | --- |
| `accounts` | Bot 凭据、`get_updates_buf` 游标、启停、退避与暂停状态 |
| `logins` | 进行中的扫码登录（10 分钟过期） |
| `peers` | 每个联系人的最新 `context_token` 与可回复状态 |
| `messages` | 收发消息；`(bot_id, wx_message_id)`、`(bot_id, client_id)` 唯一 |

游标与消息在同一事务写入，仅在服务端返回非空游标时前进。重启、部署或对象被回收后，轮询从已保存游标继续。
保留 30 天且每个 Bot 最多 20000 条。移除账号会删除其全部数据。
不使用 KV：KV 最终一致、无原子读改写、无 alarm，无法保证游标、去重和单一轮询者。

## 轮询

DO alarm 驱动长轮询，不依赖 Cron。每次 alarm 先设置 90 秒看门狗，再轮询最多 45 秒，最后按最早到期时间重设 alarm；没有启用的账号时删除 alarm。
- `ret` 或 `errcode` 为 `-14`：暂停一小时；连续两次则 `needs_relogin` 为真，需重新扫码。
- 网络、HTTP 或其他业务错误：指数退避，上限 300 秒，成功后清零。
- 客户端超时视为空结果。
- 轮询期间账号被移除或重新登录时，丢弃该次结果。
- 64 位消息 ID 以字符串保存。

服务端返回的 `baseurl`、`redirect_host` 仅在 `https` 且属于 `weixin.qq.com` 时采用，Bot token 不会发往其他主机。请求不跟随重定向。

## 发送

回复必须使用该联系人最新的 `context_token`；没有则拒绝，不主动发起。同一 `client_id` 重试不会重复发送。
网络失败时结果记为 `unknown`，不自动重发，应先读取消息确认。当前不支持群发送和媒体。
入站媒体仅保存类型与描述，CDN 密钥与下载参数被剔除。

## MCP 工具

| 工具 | 说明 |
| --- | --- |
| `wechat_login_start` / `wechat_login_poll` | 获取二维码内容；轮询扫码结果（含验证码） |
| `wechat_list_accounts` / `wechat_account_status` | 账号与轮询状态，不返回凭据 |
| `wechat_list_conversations` | 会话列表与 `can_reply` |
| `wechat_read_messages` | 按 `after_id` 增量读取，客户端保存 `next_after_id` |
| `wechat_send_text` | 回复私聊文本 |
| `wechat_set_polling` | 暂停或恢复接收 |
| `wechat_logout` | 删除账号与全部数据，需 `confirm_account_id` |

消息文本来自第三方，工具说明将其标为数据而非指令。

## 配置与核验

`wrangler.jsonc` 的变量 `ILINK_BASE_URL`、`ILINK_CLIENT_VERSION`、`ILINK_BOT_AGENT` 不含机密，无 Worker secret。
本地检查（在 `apps/wechat`）：`pnpm typecheck`、`pnpm test`、`pnpm test:runtime`（真实 workerd、DO alarm、重启恢复）、`pnpm build`。
`wechat_list_conversations` 用 `before_last_message_at` 翻页，同一毫秒的会话可能被跳过。
同一个 Bot 只应有一个消费者；其他客户端同时读取会争抢游标。

首次上线须真实联调并记录：二维码内容格式、服务端接受的版本与 `bot_agent`、`-14` 是否可恢复、`context_token` 有效期。联调只记录账号 ID 与状态，不记录凭据。

# WeChat · 微信 Bot 会话服务

`apps/wechat` 是无界面 Worker（`wechat.hasbai.xyz`）。它按 [openclaw-weixin 协议摘要](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md) 接入 iLink Bot，并通过 MCP 提供会话能力。该协议摘要只作客户端参考，字段按可缺省处理。

## 身份、隔离与持久化

- `POST /mcp` 验证共享 audience 用户 JWT，并要求 `wechat.all:all`（只授予 `superadmin`，见 [AUTHORIZATION](../AUTHORIZATION.md)）。`GET /health` 匿名可用，其余路径返回 404。
- 系统按 Auth0 `sub` 隔离每用户一个 SQLite Durable Object `WechatOwner`。不使用 KV，避免最终一致与非原子游标更新。对象内包含 4 张表：
  - `accounts`：Bot 凭据、`get_updates_buf` 游标、启停、退避与暂停状态
  - `logins`：扫码登录状态（10 分钟过期）
  - `peers`：联系人最新 `context_token` 与可回复状态
  - `messages`：收发消息（`(bot_id, wx_message_id)` 与 `(bot_id, client_id)` 唯一。每 Bot 保留 30 天内最多 20000 条）
- 游标与消息同事务提交，只在服务端返回非空游标时前进。移除账号会清空其全部数据。

## 轮询与发送

- **长轮询**：由 DO alarm 驱动（无 Cron）。每次设置 90 秒看门狗、轮询最多 45 秒，并重设下次 alarm（无启用账号时删除）。`ret` 或 `errcode` 为 `-14` 时暂停一小时，连续两次则置 `needs_relogin`。其他错误指数退避至 300 秒。客户端超时视为空结果。轮询期间账号移除或重登时，丢弃本次结果。64 位消息 ID 保存为字符串。
- **主机安全**：`baseurl` 与 `redirect_host` 只在属于 `https` 且为 `weixin.qq.com` 域名时采用。请求不跟随重定向。
- **发送约束**：系统只支持使用联系人最新 `context_token` 回复私聊文本。无 token 拒绝发送，不支持群发与媒体。入站媒体剔除 CDN 密钥并只存描述。同一 `client_id` 重试不重复发送。网络失败记为 `unknown`，必须先读消息再决定是否重发。

## MCP 工具

| 工具 | 说明 |
| --- | --- |
| `wechat_login_start` / `wechat_login_poll` | 获取二维码 URL 与轮询扫码结果（含验证码） |
| `wechat_list_accounts` / `wechat_account_status` | 账号与轮询状态（不返回凭据） |
| `wechat_list_conversations` | 会话列表与 `can_reply`（`before_last_message_at` 翻页会跳过同毫秒会话） |
| `wechat_read_messages` | 按 `after_id` 增量读取，返回 `next_after_id` |
| `wechat_send_text` | 回复私聊文本 |
| `wechat_set_polling` | 暂停或恢复接收 |
| `wechat_logout` | 删除账号及全部数据（需 `confirm_account_id`） |

工具说明已标注第三方消息为数据而非指令。同一 Bot 只能有一个轮询消费者。

## 配置、验证与发布

- `wrangler.jsonc` 变量 `ILINK_BASE_URL`、`ILINK_CLIENT_VERSION` 与 `ILINK_BOT_AGENT` 不含机密，无 Worker secret。
- **已验证（2026-11-09）**：真实服务端接受 `ILINK_CLIENT_VERSION=2.4.8` 与 `bot_agent=Hasbai`。`wechat_login_start` 原样返回 `liteapp.weixin.qq.com` 二维码 URL，初始状态为 `wait`。待首次真实登录后补录：`-14` 恢复、`context_token` 有效期、`binded_redirect` 含义。
- 本地检查见 [TESTING](../TESTING.md)（`pnpm typecheck`、`test`、`test:runtime`、`build`）。Workers Builds 首次登记从 stdin 传令牌执行 `python3 apps/wechat/scripts/setup-builds.py < token-file`。

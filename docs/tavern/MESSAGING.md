# Telegram 消息接入

Telegram 与浏览器共用 Tavern Agent（Saki 为普通 CCv2 角色卡，旧 Saki Think/独立工具/路由不进入新链路；状态与摘要沿用 [AGENT](AGENT.md)）。

## 模块、存储与命令

- `packages/messaging` 负责协议、验签、触发判断与分片发送；`worker/channels.ts` 管理绑定，`MessageInbox` DO 管理收发（共用 Tavern Worker）。
- Webhook 验签并持久入站后返回 200；每个 chat + topic 对应独立收发 DO 与 Tavern 会话（私聊/群/不同话题隔离，保留发言人 ID、昵称与回复引用）。
- 收件按 `username: content` 格式化写入 Tavern（多行缩进引用，已绑定旧会话加载时原地转换并重建派生索引；浏览器会话不转换）。普通群消息作背景保留最多 100 条（不生成摘要，超限优先剔除最早背景）。
- **触发与命令**：私聊直接回复；群中仅 @机器人或回复机器人时回复（忽略非文本、其他机器人消息与命令）。支持 `/help`、`/id`、`/start <code>`、`/bind@机器人用户名 <code>`、`/compress`、`/status`、`/ooc <指令>`（控制命令仅限绑定账号执行，与普通消息共用持久队列，状态/压缩从 activity 终态回执）。管理员调用 `POST /api/messaging/telegram/commands` 同步菜单。

## 账号与绑定

- 设置页「Telegram 接入」生成 10 分钟单次绑定码，绑定前须选择本人已安装角色（不隐式同步内置原卡）。私聊 `/start <code>` 绑定账号；群管理员私聊绑定后再在群/话题发送定向 `/bind@机器人用户名 <code>`（绕过隐私模式限制），校验账号关联与群管理员身份并创建独立群会话（不继承浏览器 persona/系统提示）。
- 设置页也支持按对话 ID（+ 话题 ID）直接绑定（不消费绑定码；不支持频道）。绑定仅读角色快照，更新 Saki 须先改卡再经[会话接口](ARCHITECTURE.md#api-清单)同步。
- 管理接口验签共享 JWT 并按 `sub` 隔离；Gateway `username` 取自 Auth0 claim，Webhook 仅验配置 secret，绑定码不入聊天记录或日志（完整权限见 [AUTHORIZATION](../AUTHORIZATION.md)）。

## 排队与投递

- 同一会话按入站 update 顺序串行，每条保存固定 UUID 幂等调用 `TavernSession`（409 忙时等待重试）。触发消息入队后尝试加 👀（被群权限拒不阻塞）。
- 生成中每秒读取草稿草拟/编辑预览（首次用 `reply_parameters` 回复持久化源消息 ID），仅 `completed + stop` 确认完成（失败替换为未完成提示；不发送候选、思考或工具协议）。
- 单片 ≤ 4000 UTF-16 单位（不拆 Unicode 代理对）；发前记尝试状态、成功后记 message ID（429 按 `retry_after` 等待；内容未变编辑视成功）。网络结果不明或重启发现未确认发送时暂停队列，由设置页核对后手动重试剩余分片或跳过（不承诺 exactly-once）。已完结凭据保留 7 天。解绑停用路由、取消待发并保留 Tavern 会话。

## 从 Saki 切换（已完成）

2026-10-19 已切至 `/api/messaging/telegram/webhook` 并按用户要求删除旧 Worker、DO、KV、域名与 Access 资源（不迁移旧聊天记录；`scripts/saki-cutover.mjs` 留作追溯）。

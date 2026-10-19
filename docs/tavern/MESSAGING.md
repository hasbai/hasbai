# Telegram 消息接入

Telegram 与浏览器共用 Tavern Agent。
Saki 是普通 CCv2 角色卡。
角色、工具、模型、状态与摘要均沿用 [AGENT](AGENT.md)。
旧 Saki 的 Think、独立工具与模型路由不进入新链路。

## 模块与存储

`packages/messaging` 提供协议、验签、触发判断和分片发送。
它不持有酒馆账号、角色或记忆。
`worker/channels.ts` 管理绑定，`MessageInbox` DO 管理收发。
消息中台和酒馆共用现有 Worker，无新增部署单元。

Webhook 在验签和持久入站成功后返回 200。
每个 chat + topic 对应独立收发 DO 和 Tavern 会话。
私聊、群和不同话题不共用历史。
输入保留发言人 ID、昵称与回复引用。

普通群消息仅作背景，最多保留最近 100 条。
触发回复时，最近背景随当前输入交给 Tavern。
输入超限时先移除最早背景，保留当前输入。
消息中台不生成摘要。

私聊直接回复；群中 @机器人或回复机器人时回复。
非文本消息、机器人消息和其他机器人的命令不进入模型。
旧 `/search` 等 Saki 命令不再执行。

## 账号与绑定

设置页的「Telegram 接入」生成十分钟单次绑定码。
私聊发送 `/start <code>`，关联 Telegram sender 与酒馆账号。
群管理员先完成私聊绑定，再在目标群或话题发送 `/bind <code>`。
群绑定检查相同账号及 Telegram 群管理员身份。
每次绑定创建新会话，不能挂接已有私人会话。
群会话不继承浏览器的 persona 或私人系统提示词。

管理接口验证共享用户 JWT，并按 `sub` 隔离。
绑定中的 username 来自已验证 Auth0 claim。
Telegram 昵称仅是消息数据，不作为 owner 或 Gateway 身份。
绑定码不进入聊天历史或日志。
Webhook 仅接受配置的 secret，不接受用户自报身份。
完整权限规则见 [AUTHORIZATION](../AUTHORIZATION.md)。

## 排队与投递

同一会话按入站 update 顺序串行执行。
每条入站消息持久保存固定 UUID，重启和重试复用该 UUID。
调用现有 `TavernSession`，不复制 Agent 或工具循环。
409 忙时等待重试；pending 等待持久终态。

只有 completed + stop 的正文可以投递。
候选、思考、工具协议及未完成正文不会发送到 Telegram。

每个 Unicode 完整分片不超过 4000 个 UTF-16 单位。
发送前保存尝试状态，成功后保存 Telegram message ID。
429 按 retry_after 等待，已确认成功的分片不重发。

网络结果不明或重启发现未确认发送时，暂停队列。
设置页可核对状态，再重试剩余分片或跳过。
人工重试不明发送可能重复投递，不承诺 exactly-once。
已完成及已取消的收件凭据保留七天。

解绑先停用路由，再取消未完成任务和待发队列。
每次发送前检查路由；已开始的外部发送无法撤回。

解绑保留 Tavern 对话，用户可在酒馆查看或删除。

## 从 Saki 切换

先完成隔离迁移、测试与自动部署，再切换 webhook。
不得先停用旧入口而让新入口不可用。
新入口为 `/api/messaging/telegram/webhook`。
Bot token 和 webhook secret 仅保存在服务端。
沿用同一个 bot，切换时不丢弃待处理 update。

内置卡源于旧仓库默认文案，移除旧工具和 runtime 说明。
线上 KV 覆盖须作为本人私有角色导入，不提交 Git。
没有覆盖时使用内置角色卡。
用户已确认不迁移旧聊天记录；新会话从绑定时开始。

2026-10-19 已切换到 Tavern，并按用户要求删除旧记录和专属资源。
旧 Worker、四个 DO namespace、提示词 KV 和兼容域名已删除。
旧 Access 应用、测试令牌和自动构建配置已删除。
旧域名不再提供转发或跳转。
Telegram bot、当前绑定和 Tavern 新会话继续使用。
共享 Gateway、模型 provider 与构建令牌按实际引用保留。

生产接管须分别核验 webhook、绑定、真实消息收发及 Gateway 路由。
本地模拟测试不能证明 Telegram 真实投递成功。

`scripts/saki-cutover.mjs` 仅保留切换实现供追溯。
旧项目的本地凭据和运行缓存已清理，不再重复执行旧切换流程。
后续部署及数据库迁移按 [TESTING](../TESTING.md)执行。

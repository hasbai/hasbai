# Tavern Agent 与会话一致性

适用于 `apps/tavern/worker/agent.ts`、`session-object.ts`、`session-store.ts`、检索与上下文模块。此页维护当前正文 Agent、状态、存储和检索契约；Director 前缀复用/候选/按需压缩以[MODELS](MODELS.md#正文结束后的-director-agent)为准。发布证据和未解决差异见[PROGRESS](PROGRESS.md)，旧候选/预算方案在[历史记录](history/AGENT-ITERATIONS.md)。

## 状态与工具

每个 assistant 版本保存 before/after 状态和工具步骤。scene、facts、relationships、inventory 采用有界 JSON patch，省略保留，null 删除；白名单、深度、字节和单项长度有界，不预建游戏引擎。

`update_state` 仅暂存已发生事实，可供本回合工具后请求读取；只有正文正常完成且整回合未停止时，与 message、快照和 revision 在 DO 同一事务提交。长度中断、取消、断流或工具失败不提前提交；候选故障保留成功正文/状态。

重生成从对应版本 before 开始，成功后才选中新的剧情状态。失败版本可见，Prompt/state/记忆使用最新成功剧情版本。新分支仅复制编辑点之前的有效 state/摘要，重映射来源锚点，排除编辑点旧 after 与工具步骤，不继承未来事实。

| 工具 | 输入与输出 | 约束 |
| --- | --- | --- |
| `search_memory` | query:string → 最多三条 `id,text,source` | 只查本人当前会话成功剧情/启用世界书，返回版本来源 |
| `update_state` | patch:object → 暂存结果或字段错误 | 不接受未来候选行动，不直接提交 |

工具不接受 URL、SQL、owner 或 session 参数，执行环境由服务端绑定。外部检索/索引前整批纯校验非法字段、重复调用及批内重复，合法调用按原顺序追加实际 tool_calls/results；工具返回是数据，不能改 system 或权限。不从普通剧情正则触发更新，不执行角色脚本。

上游原生工具增量中的顶层 `tool_calls:null` 等同未提供该字段；真实工具分片的可选 ID/type/function/name/arguments 为 null 时不覆盖已有累计值。index 必需，保留类型、身份、重复 ID、参数和空终态校验，不递归清洗业务 patch 或参数字符串中的 null。可选字段全空也不能把未完成 index 伪装成无工具。

## 检索与原文

DO 成功消息版本与状态事务是权威剧情；摘要、旧 Director 梗概、模型投影、世界书分块和向量是带来源版本的派生数据，可失效/重建，不能反向改写私人原文。

会话历史用关键词召回，世界书保留关键词/常驻激活，并按需补充版本化关键词/向量检索。分块绑定 book/entry/content hash，移除未绑定或旧版本；每次最多新增八块向量、总检索十秒，渐进补齐。固定 `@cf/baai/bge-m3` 仅用于嵌入，通过已有 AI/Gateway 和三项归属日志；不可用则返回真实关键词结果，停止立即退出。不新增索引服务或浏览器模型入口。

两源都有命中时取已召回历史中时间最新的两条、最优世界书一条，空缺由另一源补齐。历史保持时序，世界书保留内部排序，不直接比较分值。合并去重用 `id + source`，回合检索进展用 `id + source + text`；同 query 在外部检索前拒绝，不同 query 返回新片段可续轮，完全相同片段则停止。不能声称召回覆盖所有语义更正。

长消息片段用最长已命中词优先、等长最早命中；规范化小写索引映回原文 Unicode 字符，再取前 100 / 总 600 字符窗口。中文二元词按 Unicode 字符生成，避免扩展区汉字、emoji 残代理或小写扩长造成空片段。来源过滤、成功版本和三条上限保留。

## Prompt 与模型投影

保持直接 TypeScript 模块，不引入通用插件框架或 Agents SDK。
提示词读取与编辑见[应用提示词](ARCHITECTURE.md#应用提示词)。
正文使用一个稳定 system，包含用户配置、角色卡、世界书与短应用协议。
协议只约束事实连续性、用户行动边界、工具及输出格式。
写作风格与篇幅由用户配置和角色卡决定，不追加逐轮写作提醒。

来源已校验的 checkpoint 仍在首条 system 内，位于应用协议之后。
随后放完整近期剧情和当前确认 state。
空 state 不注入消息，用户本轮原文仍在末尾。
state 消息只含数据，不拼入应用指令。
角色宏及世界书位置见[架构](ARCHITECTURE.md#角色卡与世界书)。

跨轮模型投影从完整有效剧情和已校验 checkpoint 重建。
不保存请求 wire 中的旧 state、工具协议或阶段任务。
不用文本匹配删除用户内容，角色卡、用户配置与历史原文不改写。
格式版本和来源指纹使旧投影失效，下一轮使用当前规则重建。
前缀相同不等于真实 GPU 缓存命中。

同轮工具请求保留真实 assistant tool_calls 与 tool results。
不在工具结果后追加假 user 提醒。
正文 length 直接结束为错误，不发起续写。
输出检查失败保留原稿并报错，不生成替换稿。
Director 复用本轮实际 wire，阶段任务不进入正文记忆。

JSON 紧凑编码和稳定键序，移除锁、revision、时间及日志字段。
压缩只处理已解析确认的剧情，不处理工具参数或候选。
兼容候选标记及未确认协议片段不能作摘要源。

正文尚无输出时，明确超限可压缩输入后重试。
已有累计正文时超限直接结束，不重发或压缩半稿。
按 Unicode 字符拆小剧情源，单字符不可再拆时明确报错。
持久正文和消息版本不裁剪。

投影校验正文版本、角色、设置、世界书、system 和来源指纹。
编辑、压缩或角色与世界书激活变化后重建。
候选不进入正文投影或剧情摘要。

## 正文流式展示与检查

正文增量随上游持续返回，不等待全文检查或候选生成。
兼容旧候选分隔符只处理协议边界，不改写正文。
私有 `generation_drafts` 保存实际输出检查点，pending GET 不暴露草稿。

可靠 stop 后检查 think 标记、同轮长段重复与跨轮精确复写。
跨轮检查最近三个成功正文。
至少两段各不少于60字的原文匹配，且占新稿至少45%，才判为复写。
明确回顾或总结请求豁免跨轮检查，否定请求不豁免。
检查不能识别全部同义复读或语义停滞。

检查失败返回 `invalid_output`，完整原稿可见，不发起自动修订。
长度中断、故障或停止均保存实际部分输出，不发起自动或手动续写。
旧客户端的 `continue:true` 返回400。
用户可主动重新生成完整回复，新版本从原 before 状态开始。
错误和中断版本不提交暂存状态、候选或成功投影。
刷新和 UUID 回放读取同一结果，不再推理。

停止或重启恢复检查点为未完成版本，保留实际草稿。
恢复不检查后清空稿件，不提交暂存状态。
最终消息写入、状态提交及检查点删除在同一 SQLite 事务中完成。

## 上下文与摘要

不设固定 32K/12K 输入目标、maxTokens、总正文长度、模型请求次数或整轮 deadline。只读 `/props` 发现实际 n_ctx，五分钟缓存并后台刷新；未知容量保留全部有效历史，不猜窗口。字符估算带倍率和 256 tokens 模板估算量，不预扣输出额度，也不每轮额外请求 token 计数。

输入超过已发现容量或遇明确 context 超限才按时间顺序压缩较早完整剧情，保留当前输入/核心卡片与原消息。摘要绑定消息 ID/版本/内容指纹，记录确认事实、关系、否定更正和未决线索；原文、导出与全部版本不删除。摘要失败保留原文和上一有效 checkpoint；摘要输入超限时拆小来源，并强制縮短/检查进展，不逐轮总结正文。

压缩请求保留源剧情的 user/assistant 角色，最后仅追加一条 user 压缩任务。
不发送 system 压缩指令，不把半成品摘要作为后续输出前缀。
拆小来源时每个请求沿用这一顺序。

摘要输出 length 直接报错，不拆源重发。
同轮工具协议保持完整，不压缩已输出半稿。
核心卡片或当前输入超过物理窗口且无可压缩历史时明确报错。
180秒持续续租用于故障恢复，覆盖摘要和正文，不是整轮时限。

Director 复用正文实际前缀，不逐轮生成独立梗概；仅超限时从已确认剧情创建临时压缩上下文，候选指令和候选内容不进入正文摘要。详细契约见 MODELS。

## DO与迁移一致性

Worker 先验证共享身份，再按稳定 owner + session 路由每会话 SQLite DO，不使用全局 DO。create/get/generate/stop/update/fork/delete/export 均走同一存储入口；D1 保存目录、角色库、世界书、设置和旧迁移来源，R2 保留私有原件。

惰性迁移只在旧生成为空/到期时，在 D1 原子设置 storage_backend=do 与永久 `generation_id=do:<sessionId>` 哨兵冻结旧 Worker。保留全部 ID/ordinal/候选/终态/摘要/版本，DO 同事务导入并逐字段校验；失败保留冻结来源供重试，不删旧记录。

切换后只写 DO，D1 同步列表和世界书引用；新会话/分支先创建 D1 目录及来源，失败仍可惰性恢复。0007 增加 storage_backend/deleted_at，0008 增加分支 seed；回滚先停写并导出 DO 新消息，不能回到陈旧 D1 覆盖历史。

DO revision/synced_revision 与 alarm 幂等重试目录同步，正文 done 不等待 D1 网络。世界书更新先持久标记 dirty，再预留旧+新引用并集，DO 成功后才收窄；故障/重启按已提交状态恢复，目录失败不把已成功正文当失败。

删除先持久标记清理意图与重试 alarm。确认 D1 删除标记、隐藏目录并释放绑定，再 await `deleteAll`。全部私有 SQLite/元数据与 alarm 清空成功后才返回。失败用同一意图、重复 DELETE 或 alarm 重试，不提前取消重试 alarm。生成或收尾未结束仍拒绝删除。

构造函数不建表，已删除对象的旧请求不能重建表或重导入；D1 删除标记永久防复活，普通同步不得清除。DO 不永久保留 tombstone，空实例随运行时关闭释放，不承诺内存立即销毁或本地文件零字节。依据：[SQLite deleteAll](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#deleteall)、[DO 生命周期](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/#remove-a-durable-objects-storage)。

初始化消息与 before 快照同一 SQLite 事务，快照失败回滚新消息且原 UUID 可重试。最终事务失败仍结束内存任务，只恢复该任务 ID 的未提交占用。保留已落盘正文，将 pending 改为 interrupted，保留 stopped/disconnected 原因。

不提交推测 state/投影，不伪报 done，不自动重发模型。持续故障保留恢复 ID，后续 read/generate/delete 重试；旧 ID 不清新占用。冷实例删除先恢复未完成任务，恢复成功才发布缓存。

短事务领取占用，外部模型 await 期间允许 stop，不持有 blockConcurrencyWhile。重复 UUID 回放，其他并发请求冲突；重启未完成回合标中断，不自动重复推理。

客户端暂停读取 start/delta/candidates_pending 时，写入必须响应停止/断连，中止不续租。先保存终态/释放 DO 活跃状态，再直接入队最多 error/done 两帧结束流；正常 done 同样不等 reader，主动结束不误判断连。持久化异常也结束传输；reader 恢复之前删除即可清空存储/alarm。兼容日期支持标准 TransformStream，依据[兼容标志](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#standard-transformstream-constructor)。

## 缓存与性能证据

Gateway 完整 payload、eventId、三项 metadata 和 `skipCache:true` 契约见[MODELS](MODELS.md)。回复缓存与模型 KV 缓存不同，`cache_prompt:true`、稳定 messages 前缀或 DO 持久化本身不是 GPU 命中证据。

同卡连续至少三轮、切会话返回，并测角色变化、checkpoint、窗口超限、重生成/取消。记录实际 prompt/cached tokens、正文 TTFT、模型 prefill/decode 和总耗时；缺字段为 null，不编命中率，冷/热描述测试序列。Worker 既有 10% 采样与 Gateway 完整响应分别核对。

历史单 slot 实测同轮命中而跨轮为零，保留正确剧情隔离。后续 slot 亲和只针对真实支持服务，有租约/公平调度/有限容量，不把 UUID 当 slot，也不为每会话无限保存 GPU 缓存。

## 后续目标

已有 DO/state/原生工具/关键词记忆/世界书混合检索、模型投影与独立 Director。当前入口变更后的真实工具回合与日志关联差异优先按[PROGRESS](PROGRESS.md)处理。

未来只在实际样本证实收益后评估按锚点 `read_memory`、单阶段候选重试、后台状态结算、会话记忆 embedding、精确 tokenizer 和多 slot 亲和。新增能力前先明确来源、权限、取消、版本隔离及验收条件。目标不写成现有功能。不新增模型入口、角色脚本或额外服务。

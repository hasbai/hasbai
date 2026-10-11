# Tavern Agent 与会话一致性

适用于 `apps/tavern/worker/agent.ts`、`session-object.ts`、`session-store.ts`、检索与上下文模块。此页维护当前正文 Agent、状态、存储和检索契约；Director 前缀复用/候选/按需压缩以[MODELS](MODELS.md#正文结束后的-director-agent)为准。发布证据和未解决差异见[PROGRESS](PROGRESS.md)，旧候选/预算方案在[历史记录](history/AGENT-ITERATIONS.md)。

## 状态与工具

每个 assistant 版本保存 before/after 状态和工具步骤。scene、facts、relationships、inventory 采用有界 JSON patch，省略保留，null 删除；白名单、深度、字节和单项长度有界，不预建游戏引擎。

`update_state` 仅暂存已发生事实，可供本回合续轮读取；只有正文正常完成且整回合未停止时，与 message、快照和 revision 在 DO 同一事务提交。length 续写、取消、断流或工具失败不提前提交；候选故障保留成功正文/状态。

重生成及中断续写从对应版本 before 开始，成功后才选中新的剧情状态。失败版本可见，Prompt/state/记忆使用最新成功剧情版本。新分支仅复制编辑点之前的有效 state/摘要，重映射来源锚点，排除编辑点旧 after 与工具步骤，不继承未来事实。

| 工具 | 输入与输出 | 约束 |
| --- | --- | --- |
| `search_memory` | query:string → 最多三条 `id,text,source` | 只查本人当前会话成功剧情/启用世界书，返回版本来源 |
| `update_state` | patch:object → 暂存结果或字段错误 | 不接受未来候选行动，不直接提交 |

工具不接受 URL、SQL、owner 或 session 参数，执行环境由服务端绑定。外部检索/索引前整批纯校验非法字段、重复调用及批内重复，合法调用按原顺序追加实际 tool_calls/results；工具返回是数据，不能改 system 或权限。不从普通剧情正则触发更新，不执行角色脚本。

上游原生工具增量中的顶层 `tool_calls:null` 等同缺省；真实工具分片的可选 ID/type/function/name/arguments 为 null 时不覆盖已有累计值。index 必需，保留类型、身份、重复 ID、参数和空终态校验，不递归清洗业务 patch 或参数字符串中的 null。可选字段全空也不能把未完成 index 伪装成无工具。

## 检索与原文

DO 成功消息版本与状态事务是权威剧情；摘要、旧 Director 梗概、模型投影、世界书分块和向量是带来源版本的派生数据，可失效/重建，不能反向改写私人原文。

会话历史用关键词召回，世界书保留关键词/常驻激活，并按需补充版本化关键词/向量检索。分块绑定 book/entry/content hash，移除未绑定或旧版本；每次最多新增八块向量、总检索十秒，渐进补齐。固定 `@cf/baai/bge-m3` 仅用于嵌入，通过已有 AI/Gateway 和三项归属日志；不可用则返回真实关键词结果，停止立即退出。不新增索引服务或浏览器模型入口。

两源都有命中时取已召回历史中时间最新的两条、最优世界书一条，空缺由另一源补齐。历史保持时序，世界书保留内部排序，不直接比较分值。合并去重用 `id + source`，回合检索进展用 `id + source + text`；同 query 在外部检索前拒绝，不同 query 返回新片段可续轮，完全相同片段则停止。不能声称召回覆盖所有语义更正。

长消息片段用最长已命中词优先、等长最早命中；规范化小写索引映回原文 Unicode 字符，再取前 100 / 总 600 字符窗口。中文二元词按 Unicode 字符生成，避免扩展区汉字、emoji 残代理或小写扩长造成空片段。来源过滤、成功版本和三条上限保留。

## Prompt 与模型投影

保持直接 TypeScript 模块，不引入通用插件框架或 Agents SDK。正文逻辑顺序为稳定短 system/工具 schema → 角色/persona/世界书约束 → 低频摘要 checkpoint → 完整近期剧情 → 当前 state/输入 → 实际工具调用与结果。角色宏及世界书位置见[架构](ARCHITECTURE.md#角色卡与世界书)。

工具续轮冻结基础 prompt，只追加实际结果；JSON 紧凑编码和稳定键序，移除锁/revision/时间/日志字段。持久投影保留用户原文和实际工具协议，提示格式版本变化使旧投影失效，来源版本/正文/角色/设置/世界书与 system 均校验。普通下一轮追加，压缩、角色/世界书激活变化或编辑使投影失效；候选不进入正文投影或剧情摘要。

同次响应含正文和 tool_calls 时，仅已解析确认的剧情可压缩，wire 比对允许 CRLF/空白缓冲差异；保留调用、参数、结果及顺序。兼容候选标记或未确认协议片段不能作剧情摘要源，工具/length/流式超限入口保持一致。按 Unicode 字符拆小剧情源，单字符不可再拆时报告无法容纳，不重试同源或残代理；持久正文/版本不裁剪。

## 上下文与摘要

不设固定 32K/12K 输入目标、maxTokens、总正文长度、模型请求次数或整轮 deadline。只读 `/props` 发现实际 n_ctx，五分钟缓存并后台刷新；未知容量保留全部有效历史，不猜窗口。字符估算带倍率和 256 tokens 模板估算量，不预扣输出额度，也不每轮额外请求 token 计数。

输入超过已发现容量或遇明确 context 超限才按时间顺序压缩较早完整剧情，保留当前输入/核心卡片与原消息。摘要绑定消息 ID/版本/内容指纹，记录确认事实、关系、否定更正和未决线索；原文、导出与全部版本不删除。摘要失败保留原文和上一有效 checkpoint；摘要本身超限或 length 时拆小来源，并强制縮短/检查进展，不逐轮总结正文。

length 保存实际部分正文后继续同一 assistant 消息、UUID 和 SSE，必要时只压缩长回复的模型投影。最终 stop 才提交成功状态与候选流程；无进展、非法协议、取消、断连或上游故障保存部分正文并释放占用。核心卡片/当前输入单独超过物理窗口且无可压缩历史时明确报错，不静默截掉内容。180 秒持续续租是恢复租约，覆盖摘要/正文，不是整轮时限。

Director 复用正文实际前缀，不逐轮生成独立梗概；仅超限时从已确认剧情创建临时压缩上下文，候选指令和候选内容不进入正文摘要。详细契约见 MODELS。

## DO与迁移一致性

Worker 先验证共享身份，再按稳定 owner + session 路由每会话 SQLite DO，不使用全局 DO。create/get/generate/stop/update/fork/delete/export 均走同一存储入口；D1 保存目录、角色库、世界书、设置和旧迁移来源，R2 保留私有原件。

惰性迁移只在旧生成为空/到期时，在 D1 原子设置 storage_backend=do 与永久 `generation_id=do:<sessionId>` 哨兵冻结旧 Worker。保留全部 ID/ordinal/候选/终态/摘要/版本，DO 同事务导入并逐字段校验；失败保留冻结来源供重试，不删旧记录。切换后只写 DO，D1 同步列表和世界书引用；新会话/分支先创建 D1 目录及来源，失败仍可惰性恢复。0007 增加 storage_backend/deleted_at，0008 增加分支 seed；回滚先停写并导出 DO 新消息，不能回到陈旧 D1 覆盖历史。

DO revision/synced_revision 与 alarm 幂等重试目录同步，正文 done 不等待 D1 网络。世界书更新先持久标记 dirty，再预留旧+新引用并集，DO 成功后才收窄；故障/重启按已提交状态恢复，目录失败不把已成功正文当失败。

删除先持久标记清理意图与重试 alarm，确认 D1 删除标记/隐藏目录/释放绑定，再 await `deleteAll` 清空全部私有 SQLite/元数据与 alarm，成功后才返回。失败用同一意图、重复 DELETE 或 alarm 重试，不提前取消重试 alarm。生成或收尾未结束仍拒绝删除。

构造函数不建表，已删除对象的旧请求不能重建表或重导入；D1 删除标记永久防复活，普通同步不得清除。DO 不永久保留 tombstone，空实例随运行时关闭释放，不承诺内存立即销毁或本地文件零字节。依据：[SQLite deleteAll](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#deleteall)、[DO 生命周期](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/#remove-a-durable-objects-storage)。

初始化消息与 before 快照同一 SQLite 事务，快照失败回滚新消息且原 UUID 可重试。最终事务失败仍结束内存任务，只恢复该任务 ID 的未提交占用：保留已落盘正文，pending → interrupted，保留 stopped/disconnected 原因，不提交推测 state/投影，不伪报 done 或自动重发模型。持续故障保留恢复 ID，后续 read/generate/delete 重试；旧 ID 不清新占用。冷实例删除先恢复未完成任务，恢复成功才发布缓存。

短事务领取占用，外部模型 await 期间允许 stop，不持有 blockConcurrencyWhile。重复 UUID 回放，其他并发请求冲突；重启未完成回合标中断，不自动重复推理。

客户端暂停读取 start/delta/candidates_pending 时，写入必须响应停止/断连，中止不续租。先保存终态/释放 DO 活跃状态，再直接入队最多 error/done 两帧结束流；正常 done 同样不等 reader，主动结束不误判断连。持久化异常也结束传输；reader 恢复之前删除即可清空存储/alarm。兼容日期支持标准 TransformStream，依据[兼容标志](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#standard-transformstream-constructor)。

## 缓存与性能证据

Gateway 完整 payload、eventId、三项 metadata 和 `skipCache:true` 契约见[MODELS](MODELS.md)。回复缓存与模型 KV 缓存不同，`cache_prompt:true`、稳定 messages 前缀或 DO 持久化本身不是 GPU 命中证据。

同卡连续至少三轮、切会话返回，并测角色变化、checkpoint、窗口超限、重生成/取消。记录实际 prompt/cached tokens、正文 TTFT、模型 prefill/decode 和总耗时；缺字段为 null，不编命中率，冷/热描述测试序列。Worker 既有 10% 采样与 Gateway 完整响应分别核对。

历史单 slot 实测同轮命中而跨轮为零，保留正确剧情隔离。后续 slot 亲和只针对真实支持服务，有租约/公平调度/有限容量，不把 UUID 当 slot，也不为每会话无限保存 GPU 缓存。

## 后续目标

已有 DO/state/原生工具/关键词记忆/世界书混合检索、模型投影与独立 Director。当前入口变更后的真实工具回合与日志关联差异优先按[PROGRESS](PROGRESS.md)处理。

未来只在实际样本证实收益后评估按锚点 `read_memory`、单阶段候选重试、后台状态结算、会话记忆 embedding、精确 tokenizer 和多 slot 亲和。新增能力先明确来源/权限/取消/版本隔离与验收条件，不把这些目标写成现有功能，不新增模型入口、角色脚本或额外服务。

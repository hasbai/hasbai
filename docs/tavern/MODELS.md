# Tavern 模型参数与独立 Director

服务端仅提供白名单逻辑模型，当前 `rp` 对应 Gateway `default` / `dynamic/rp`，实际 provider/model 由 Gateway 配置决定。本文是参数、候选协议及 UI 的维护入口；运行实现见 `apps/tavern/shared/settings.ts`、`worker/director.ts`、`worker/gateway.ts`。不靠 route version/schema/管理 API 探测作为聊天准入，推理凭据只在 Worker Secret 中使用；不依赖管理 Token。

当前实现和最新真实验收缺口见[PROGRESS](PROGRESS.md)。

## 角色卡生成

角色创建独立于会话及 Director，复用 `dynamic/rp` 固定 HTTP Gateway，不接受客户端模型、URL 或凭据。`worker/character-generation.ts` 使用首位 system 创作规则和 user 草稿数据，关闭思考，发送 `shared/character-draft.ts` 的 `response_format:json_schema`。生成请求使用独立 UUID、完整 payload 日志与 `app=tavern/task=character-generation/username` attribution。

输入和输出严格字段校验，模型输出只在可靠 stop 后回填完整 CCv2。不增加字段、输入输出长度或数组数量限制；异常返回可重试错误，保留用户草稿；没有持久会话、占用、候选或自动续写。此流程的真实 schema 支持须独立验收，不由 Director 夹具外推。

## 设置、默认值与模型边界

| 设置 | 应用默认值 | 校验 / 请求行为 |
| --- | --- | --- |
| 模型 `modelId` | `rp`，显示“RP 动态路由” | 服务端白名单映射到 `dynamic/rp`，首期只提供这一个真实选项 |
| 启用思考 `thinkingEnabled` | **false，关闭** | 必须是布尔值；通过真实上游支持的参数关闭，不靠隐藏输出或提示词实现 |
| 思考强度 `reasoningEffort` | `low`，低 | 低 / 中 / 高对应 low / medium / high；关闭时保留选档 |
| 温度 `temperature` | 0.9 | 0–2，步长 0.05 |
| Top P `topP` | 1 | 大于 0 且不超过 1，步长 0.01；实际传 `top_p` |
| Top K `topK` | 0，显示“模型默认” | 0 表示不覆盖上游设置，请求省略字段；非零为 1–1000 的整数，直接传 top_k |
| 频率惩罚 `frequencyPenalty` | 0 | 目标范围 −2–2，实际传 `frequency_penalty`，直接透传 |
| 存在惩罚 `presencePenalty` | 0 | 目标范围 −2–2，实际传 `presence_penalty`，直接透传 |

这些是应用默认配置，不代表全部上游都支持。Top K 为 0 不等于关闭上游 Top K；Top P 为 1 保持宽松默认，温度继续承担主要采样调节。不先添加未经要求、未经真实验证的 Min P、种子或额外采样器。

`GET /api/models` 返回 RP 选项及已获取的上下文容量。RP 始终可选，客户端仅提交逻辑 ID，不接受任意上游模型、路由、URL 或密钥。未知 ID 返回字段错误。

标准参数随请求直接发送，默认 `chat_template_kwargs.enable_thinking:false`，同时 `reasoning_effort:none`；开启时传 true 和保存的 low / medium / high。缺少强度字段的旧设置补 low。

关闭思考仍传 none，不清除所选强度。摘要和角色生成保持关闭思考。Director沿用正文思考开关与强度，不切换正文模板。开启时另传`thinking_budget_tokens:0`，尽力限制候选推理。当前Qwen已验证生效，Gemma会忽略预算；候选仍可能慢，停止仍中止当前请求。

当前 llama 模板把 high 解释为 xhigh；应用仍透传 high，不绑定此映射。

`reasoning_format:deepseek` 分离思考与正文，不用隐藏输出代替关闭思考。

上游报错按现有失败状态保存，不删参数重试，不添加备用模型。
共享默认值、归一化、校验和模型请求映射供设置读写、会话读写、创建、分支及实际生成共用；不只在设置页补默认值。历史用户设置与会话缺少新增字段时补默认，保留已有名称、persona、系统提示、temperature、记录和 ID；旧maxTokens不再生效。特别是缺少思考字段一律得到 false。

全局设置作为新会话默认；现有会话使用自己的快照，通过会话设置保存。两处复用同一生成参数组件，会话参数不能隐藏在全局之后。

界面用“新会话默认”与“当前会话”区分范围，不增加说明段落。提供“恢复默认”操作，只重置模型和生成参数草稿，不清除身份设定；保存后才生效。生成期间禁止修改当前会话参数；请求启动时使用一致的配置快照。

## 设置页视觉与交互

沿用北极小站雪花标识、Luma neutral 色板、Lucide 与已有深浅主题，保持页面约 760px 的阅读宽度。

1. 顶部为“对话设置”和主题按钮；正文依次分为“模型”“生成参数”“角色设定”三组，模型选择、思考开关与强度放第一屏。强度在关闭思考时禁用，重新开启后保留选档。思考使用清晰的 Switch，初始关闭，不使用需要理解反向含义的“禁用思考”。
2. 生成参数桌面双列、手机单列。温度与 Top P 使用滑杆加可直接输入的数值框；Top K 与惩罚项使用紧凑数值控件。标签保留 Top P / Top K，长标签和错误自然换行。参数边界、错误就近显示。
3. 姓名、persona 与系统提示放角色设定组，不让大段 textarea 挤掉模型配置。保留正常可编辑功能，分组依靠标题、间距、细边框表达。
4. 页底“恢复默认”“保存设置”，保存中禁用重复提交，成功显示短状态。会话设置复用参数组；移动端弹层内容可滚动，底部操作不遮住字段和软键盘。
5. 不增加技术横幅、参数教学、tooltip 搬运说明或虚构推荐值。所有字段有标签，键盘焦点可见，触摸目标至少 44px，状态不只靠颜色区分。

## 续聊候选内容与 UI

roleplay先正文，后独立 Director。正文正常结束并保存后，Director 复用最后一次正文请求的实际上下文前缀，追加本次新正文与末尾的 Director user 任务。候选只有在该回复正常完成、协议与内容校验通过后可点击；停止、失败和不可靠终态均丢弃候选。成功续写或重新生成也使用同一协议。现有开场白和旧历史不补发模型请求。

候选必须是**用户视角的完整可发送文本**，承接最新故事、用户 persona 和角色设定。候选语义有区分，不替用户预设选择，不虚构已发生事件。不生成角色自己的回复，不返回抽象标签如“继续探索”。

依据上下文区分方向，不固定每轮相同模板。每条建议 15–60 个字符，服务端硬上限 120 个 Unicode 字符；候选可以是用户行动或台词。生成示例只放测试夹具，不作为生产兜底。

候选围绕未决线索、目标或眼前局面提出具体选择，引出不同信息或行动后果。避免复演已完成行动、同义问句和纯观察感叹；尊重用户慢节奏与停留要求，不编造线索或承诺未来结果。

用户最新明确禁止或暂缓的事项优先于推进要求，在用户明确恢复前持续有效，回顾请求不解除暂停；休息、慢聊或暂停调查时三条都留在该范围，不换问法重新引入暂停目标。现有物品、身份和权限须符合确认事实，不把角色物品写成用户持有。此规则只更新末尾固定 Director 任务，保留正文实际前缀。

只在最新回复下方显示“接下来”和候选按钮，处于消息阅读列内，不给全部历史挂按钮，不占固定输入区。桌面最多三张轻边框按钮，内容较长时自然换行；手机纵向排列。

整条候选可点击，右侧小箭头表示发送，文本完整可读。正文输出到尾部时在同一位置显示短骨架，不抢焦点、不强制滚动、不覆盖消息或输入框。候选无效时省略按钮，不弹全屏错误；没有合格文本时不拿固定候选补足三条。

点击候选直接发送其完整原文，不先填输入框再要求确认。重构现有发送入口为显式 content/source 参数，候选发送与手动输入复用相同 UUID、正文锁和异常处理。候选发送保留正在编辑的自由输入草稿；手动发送仍按现有规则清空已提交文本，启动失败时恢复。候选发送前再次验证关联最新回复，同步进入发送状态，防双击和键盘重复触发。

正文与候选共用现有生成锁；尾部期间允许编辑自由输入草稿，发送等待本轮完成。正文及候选完成后解锁；梗概和Director期间保留停止按钮和可编辑草稿。

发送下一轮、重新生成、切会话、编辑分支或删除后，旧候选退出当前界面，迟到结果不能插入新会话。失败不会清空草稿。保留 Enter 发送、Shift+Enter 换行和中文 IME 保护。

## 正文结束后的 Director Agent

沿用 `POST /api/sessions/:id/generate`、UUID、生成占用和停止信号。正文正常 stop 后先保存完整正文并发送 `candidates_pending`，随后由独立 TypeScript `DirectorAgent` 生成候选；不新增接口、用户设置、路由或调度器。

Director 不替换正文的首条 system、不改动用户输入，也不重建角色与故事 JSON。逐字段保留正文实际 messages、工具定义和已完成工具结果。追加最后一次正文请求的新输出，length/工具续轮不重复累计正文。最后追加独立 Director user 任务与最新已确认状态。候选协议与角色故事约束通过末尾任务区分；Director 的工具选择固定 none，禁止新调用，服务端也不执行候选阶段工具。

不再为最近四条消息之外的剧情每轮生成独立梗概。正文已有 checkpoint 随原前缀复用，未压缩的原历史完整保留。旧 DO `director_synopsis` 派生表为兼容保留，不再读取或写入；原始剧情与正文 checkpoint 不改写。

只有整体输入超过已发现容量或遇到明确 context 超限，才用独立的 `ConversationContext` 从已确认剧情重建并压缩 Director 输入。复用有效正文 checkpoint；保留当前完整正文，按需压缩较早成功历史，核心角色与最新状态不截断。摘要只能涵盖已发生剧情，Director 指令与候选不得进入摘要。此临时上下文不写入正文 summary/projection；无法容纳则保留正常正文、返回空候选。

通过同一 Gateway `dynamic/rp` 发送 `response_format: {type:"json_schema",json_schema:{name:"director_choices",strict:true,schema:...}}`。Schema 限制唯一对象字段 choices，数组恰三条，字符串非空且最多120个Unicode字符。Director 保留与正文相同的 tools schema，tool_choice 为 none。Director保持正文的思考模板参数，预算行为以本页设置说明为准。消息与工具前缀稳定为上游 KV 复用提供条件；实际命中仍以 cached tokens/prefill 计数认定，开启思考及模型模板差异单列核验。

零预算在当前llama.cpp生效，Gemma备用后端未生效，但两者均返回有效候选。此参数是尽力限制，不保证所有后端关闭思考。试验记录见[PROGRESS](PROGRESS.md)；不按计时字段猜能力，不删参数重试。

服务端聚合完整 JSON，仅在可靠 stop 时校验。检查唯一字段、恰三字符串、trim 后非空/互异、长度和控制字符。

全部合格才保存三条。代码围栏、逐行文本、额外字段、拒绝、工具响应、缺终态或 length 均丢弃全部候选；不拼半个 JSON、不逐条补缺、不填模板。Director 故障不影响已成功正文与状态提交；用户停止/断连/占用丢失仍沿原取消机制结束。

正文、Director 及按需压缩的模型请求和指标分开记录。普通回合为正文与 Director 两次请求；工具、正文续写、确定性复写修订或超限压缩才增加请求。完整 Gateway payload、eventId、skipCache 与 app/task/username 三项 metadata 保持现有契约。

候选仍与所属 message ID 一起保存为现有 nullable 元数据；刷新和 UUID 回放仅读取结果。候选不是剧情消息，不进入正文摘要或模型投影。SSE 与按钮发送契约保持现有 `candidates_pending → done`。

## 上下文与恢复

容量发现、超限压缩、checkpoint、模型投影、length 续写、停止/占用和 DO 提交以[AGENT](AGENT.md#上下文与摘要)为准。候选只在可靠 stop 且三条全部有效后原子保存，不拼接 length 的半个 JSON，不补模板。

## 验收契约

| 顺序 | 工作 | 必过条件 |
| --- | --- | --- |
| 1 | 统一默认值/校验/参数透传、固定 RP | 默认发送思考 false；路由调整不阻断对话；缺少参数的旧会话仍可读写 |
| 2 | 全局和会话参数组件、设置页分组 | 首屏思考关闭、模型可选 RP、恢复默认、范围错误、保存持久化和当前会话设置可用 |
| 3 | 候选 D1 兼容迁移、尾部解析和原请求幂等 | 隔离 D1 先验证；正文/Director持久化隔离；跨chunk JSON、三条原子验证、原UUID去重；普通长聊无逐轮梗概 |
| 4 | 候选按钮、显式发送入口、状态隔离 | 最多三条、原文点击发送、草稿保留、尾部可编辑草稿；切会话/分支/重生成丢弃旧结果 |
| 5 | 视觉、PR CI、兼容发布和真实模型验收 | 固定 Linux 截图审阅导入、必需状态全绿、D1 迁移先行、Workers Builds 自动发布与线上版本核验 |

自动化覆盖参数缺失或非法值、旧 JSON、白名单拒绝、默认 false 的实际请求映射。检查正文停止/失败/长度状态、跨 chunk 分隔符和候选JSON/空值/重复/非三条/额外字段。验证独立请求、重复UUID、并发/会话隔离、草稿与键盘发送、刷新恢复和旧结果丢弃。刷新/重复读取不暗中重试推理；短上下文预算、后台容量刷新及探测失败不中断聊天、明确超限反馈分别验证。

浏览器与视觉清单覆盖设置和会话设置的正常/加载/错误/保存/恢复默认。候选覆盖等待/成功/失败/空结果/发送及长句。设备与状态含 iPhone WebKit、desktop、深色、键盘与减弱动效。输入可用、无横向溢出、软键盘/安全区不遮挡操作分别检查；设备模拟不算真机。

真实 JWT/API 验收单列：RP 默认请求确实关闭思考，开启后也确实可切换；受支持参数实际生效；回复正常完成后候选可生成、点击原文进入下一轮、会话恢复一致。比较相同有限任务关闭/开启思考时的正文首字耗时及可用 usage。

快响应、缺少 reasoning_content 或模型口头承诺均不能证明关闭思考。正文首字、正文完成、候选就绪分别计时；验收正文、按需压缩与Director的实际请求数、原前缀与工具模板，候选JSON必须受Schema约束。

上表为验收要求，当前入口变更后的已验/未验状态见[PROGRESS](PROGRESS.md)，旧入口成功样本不外推到新入口。

## 官方契约依据

- [Cloudflare动态路由](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/usage/)：当前代码通过固定 default Gateway 的 `/compat/chat/completions` HTTP 入口调用，model 为 `dynamic/rp`。RP白名单和完整输入保持，HTTP错误与日志头由每次Response读取，不依赖绑定实例的可变日志ID。当前调用入口的真实验收限制见[PROGRESS](PROGRESS.md)；专用推理 Secret 不进入浏览器，不直连@cf模型、不删参数重试。
- [llama.cpp服务契约](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)：`/props`运行容量及`chat_template_kwargs`；当前模板实际使用enable_thinking，关闭时预填充空think，开启时等待思考内容。reasoning_format:none不是关闭思考。

正文原 system 保留；Director 的本次任务另作为末尾 user 追加；本地 Qwen 模板只允许 system 位于开头，避免触发模板错误和 Gateway 备用节点。此任务不写入用户剧情或正文投影。通知复用共享`@hasbai/ui/notice`；项目原则见[AGENTS](../../AGENTS.md#全局约束)，证据见[PROGRESS](PROGRESS.md)。

## 对话与默认提示词

消息区采用右侧用户气泡、无气泡角色正文，当前单角色会话隐藏双方姓名与头像，保留无障碍身份。发送/停止使用44px圆形图标按钮；输入框单行起步，按实际内容伸展到200px后内部滚动，发送后复位。复制、编辑与最后一条回答的重新生成放正文末尾；保留键盘、中文输入法、停止、续写和草稿。

全局与当前会话都可编辑 System Prompt，并独立恢复默认提示；全局用于新会话，现有会话保留自身快照。默认鼓励3–6段、约300–600字的自然对白与场景细节，仍由用户控制自己的行动；长度是提示目标，不设应用输出上限。短应用协议允许无新内容时简短结束，不追加逐轮篇幅提醒。

只精确升级旧默认字符串，用户自定义内容不覆盖；用户提示始终进入system，角色卡提示附加，含 `{{original}}` 时替换且不重复插入。正文用户消息只包含用户原文；Director使用JSON Schema，缓存以实际计数验收。

当前正文、按需压缩与 Director 共用 `worker/gateway.ts` 的 固定 compat/chat/completions HTTP 入口与专用运行 Secret `AIG_RP_RUN_TOKEN`，保留各次 HTTP 响应/SSE/取消与响应内日志 ID。Gateway 识别聊天协议后保存完整聚合响应及 streamed_data，浏览器仍实时接收 SSE。Gateway 要求完整请求/回复、eventId、`skipCache:true`、app/task/签名 username，单次请求不自动重试、不删参数换路由；不在应用回写 response 或用 metadata 存正文。历史聚合格式与当前 event_id 差异见 PROGRESS，不追溯改写旧日志。

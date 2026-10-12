# Tavern 交付状态

> 历史记录：保留当时的方案、命令与验收证据，不作为当前开发或发布规范。当前入口见[文档导航](../../README.md)。

## SSE背压下停止与DO释放（2026-10-05，已上线）

修复客户端暂停读取SSE时停止被writer.write卡住的问题：开始、正文和候选等待事件均响应abort；取消后不继续续租。先保存终态并释放DO活跃状态，再将最多error/done两帧入队并结束流，正常完成也不等待最终reader；主动结束不误判断连。没有增加整轮deadline、数据库迁移或界面。

- 同一组直接DO回归在修复前3/3卡在generation_id释放断言；修复后Worker/session-object共114项及TypeScript通过。覆盖阶段真实write命中、保存已生成正文、停止state不提交、UUID回放、删除；另验正常完成停读done及request.signal在blocked delta断连。Architect实现与补验复核无阻塞。
- 真实workerd在对象内部暂停读取start/delta/candidates_pending/completed四阶段，锁释放后先remove、再drain；验证done终态、业务表清空/alarm为空（SQLite基础页仍4096字节）。模型是夹具，不当作线上推理或namespace物理观测。固定Linux28流程/84截图通过，82张PNG与基线一致，其余两张当前Playwright比较器在既有50像素门槛内，未导入基线；设备模拟不是真机。
- [PR #59](https://github.com/hasbai/financial/pull/59) head `06b2b2aec1d4986df3b76c3061c0202447e08259`，Check `37262026241`、Blog `37262026157`、Zboard `37262026118`、Tavern `37262026116`各一次统一等待，八项必需状态成功；包含最新main后squash `e885d773248fe6bd40938a2375927d3091ac45b1`。
- 自动Build `ba328e33-e17e-4dc2-9a1c-d3c4f621a892` success、push_event/main/commit_hash精确匹配合并SHA；deployment `c0648174-9ea9-4bc4-a2a6-599fa94da229`，version `5abfc718-ab2f-487a-a8ed-abb3819c56f2`流量100%，health200且版本相同。没有手动部署。
- 真实Universal Login/PKCE/JWT停止请求 `9fa98f16-dbb7-4e93-b405-f74d4174d763`：生成响应暂停读取，发起STOP至GET确认锁释放419ms，此时正文0字符、aborted/stopped，同UUID回放一致。在恢复读取前同会话新请求 `204696ab-5538-4ab7-8a88-77c4c821dc5b` 正常生成2844字符及三候选，completed/stop，delta等于done；随后DELETE成功，再读取原停止流，恰一error/一done与已存消息一致并到EOF。没有证实生产网络路径真正形成writer背压，不能用419ms作为背压性能或P95；已输出正文保留以直接测试为证。
- 临时会话/角色2/2清理，全局设置逐字保持，私人历史未改。证据在忽略目录`apps/tavern/.local-visual/backpressure`与`backpressure-before-direct.log`/`backpressure-tests.log`/`backpressure-runtime.log`，Linux`2026-10-05T04-00-45.295Z`。持续goal保持active，后续沿已确认方案及实际样本迭代。

## 同次正文工具与Unicode压缩（2026-10-05，已上线）

已复现同一响应长正文+tool_calls的超限失败：正文未标为可压缩，原回合unsupported/error，无摘要请求，原文部分保留、state不提交。修复以实际解析剧情与wire比对，允许CRLF及空白缓冲差异；仅确定剧情可局部压缩，工具调用/结果顺序不改，未来候选协议不入摘要。工具/length/流式超限路径统一此判断。压缩中点改按Unicode字符，避免切断emoji；不可再拆单字符报真实失败，不重复递归同源。

- context/index/director相关134项检查及定向TypeScript通过。覆盖同次长正文工具、CRLF/末尾换行、三种候选协议隔离、三处Unicode分割/单字符进展、完整正文/状态保存；修复前同次长正文回归明确失败。
- 真实workerd/SQLite2048窗口下同次2201个emoji+tool_calls正常局部压缩，调用与结果相邻、全文/三候选/港口state/重启/UUID回放保留；模型为夹具。固定Linux28流程84图通过，81个PNG文件与基线一致，当前Playwright比较器全部通过，保留原基线；设备模拟不是真机。Architect代码/跨请求缓冲复核无阻塞。
- [PR #58](https://github.com/hasbai/financial/pull/58) head `24ca03ea18e05d1ac1a3cc4770868db8233f8583`，Check `37221246401`、Blog `37221246295`、Zboard `37221246255`、Tavern `37221246175`各一次统一等待，八项必需状态成功，包含最新main后squash `3bd05f99430ccd0a1188637f881a8180fc67ead7`。
- 主代理安全读取Builds API核验自动Build `02412b5c-5ba9-4a75-b2ff-d910043b3953` success、push_event/main/commit_hash精确匹配squash；补齐交付代理仅OAuth未取得的Build证据。deployment `84c9d4c6-78d2-4002-abab-e3779fc2a42f`的version `505d6ba0-891c-47a7-a8aa-a8167779abf7`流量100%，health200同版本，无手动部署。
- 真实Universal Login/PKCE/JWT正常回合 `d7fa3598-3354-4740-ba96-e43a92d5856d`：模型同次输出28字正文和update_state，再带完整call/result续写；两次正文、一次独立Director，全文74字、completed/stop/三候选，state/步骤导出/刷新/UUID回放/占用释放通过。Gateway三条完整payload、三项metadata、候选逐字等于JSON核对，临时角色/会话2/2清理，全局设置未变。此回合没有超限，不冒称压缩验收。
- 实际Unicode压力回合 `3aef42e6-5f22-459e-accc-65b8758a2048`：开场70028个UTF-16单元/35027个Unicode码点，正文历史与Director局部各两次摘要；四次摘要真实输入17589/17605/17619/17665 tokens，压缩后正文两次模型请求的输入tokens为697/800，Director输入489 tokens。所有实际模型请求都是合法Unicode，原始开场逐字保留；正常同次61字正文+工具后续写、总正文82字、state及三候选/刷新/UUID回放通过。七条Gateway完整payload/三项metadata/工具顺序/三候选JSON核验，两个临时资源清理，全局设置及私人历史未改。
- 上述线上压力证明历史及Director局部Unicode压缩；尚未在线上诱导同次超长正文+tool_calls再压缩，该形状以workerd/自动化为证。候选协议隔离、单字符递归退出和中断故障同样不冒称生产诱导验证。
- 首次17001emoji样本仅17684/17765输入tokens，未触发压缩，不能算压力通过；日志读请求ETIMEDOUT后清理未完成，主代理通过独立普通JWT DELETE两资源200恢复并保留证据。验收脚本为非生成API/日志增加30秒超时，生成仍无总超时；扩大样本后完成上方真实压缩验收，不重复旧模型请求。旧样本记录保存在`tool-prose-pressure/first-17001`。

本批证据位于忽略目录`apps/tavern/.local-visual/tool-prose`、`tool-prose-pressure`及Linux`2026-10-04T17-31-31.058Z`，没有Token。持续架构迭代按已确认方案和实际样本推进。

## 检索片段的匹配与Unicode边界（2026-10-05，已上线）

已复现并修复：长消息前部“北门”抢占后部完整查询“北门钥匙”的片段位置；`İ`小写扩长造成原文索引偏移、返回空片段；UTF-16窗口会切开emoji。片段改以最长匹配词定位，索引映回原文字符后取前100/总600字符。中文二元词按Unicode字符切分，扩展区汉字不会因共享单字/代理片段误命中；普通词分值、排序、来源身份/版本、三条上限与进展守卫保留。

- 关键回归在修复前明确失败，修复后agent/lore/index相关106项检查通过；涵盖完整/部分词、160字query、扩长/emoji/扩展区汉字、重复证据退出、工具续轮/导出/UUID回放。
- 真实workerd/SQLite夹具使用早期部分匹配、800个`İ`与emoji前缀，正常获得后部完整查询片段，再检索同来源其他片段；工具步骤/重启/回放通过。模型是夹具，不冒称生产。Architect补测希腊文/组合音标/补充平面大小写及代码复核通过。固定Linux28流程84图通过，81图逐像素一致，其余桌面世界书dark/角色库dark/中断回复24/1/52个原始RGB差异像素；使用当前Playwright比较器及50像素配置全部通过，中断回复仅停止按钮低强度边缘差异，保留基线。
- 创建PR前定向TypeScript发现新增测试的`String.isWellFormed`超出ES2022类型范围。改为Unicode孤立代理正则断言后，tsc通过、agent/index相关101项复跑通过；未因此创建失败PR或改变业务实现/视觉基线。
- [PR #57](https://github.com/hasbai/financial/pull/57) head `175b234e925c7953b829b5760a6a0609bcb5387f`，Check `37218795909`、Blog `37218795912`、Zboard `37218795729`、Tavern `37218795805`各一次统一等待，八项必需状态成功，包含最新main后squash `097ddd84add2635b98e46ff954972b8cf539f0da`。
- 自动Workers Build `cc2d1fb7-7dc0-4bc3-b052-9628491598d1`成功，push_event/main/commit_hash匹配上述squash；主代理通过Builds API直接核验，补齐交付代理未取得的构建SHA证据。deployment `a36c1945-cff6-4338-96cc-d2319cd8a6e5`的version `a6d30c5c-e960-46cd-bdc1-bde696bde656`流量100%，health200同版本，没有手动部署。
- 真实Universal Login/PKCE/JWT请求`a88e6e0a-2080-4b8e-ac67-30e10a38f264`，模型依次query北门钥匙/银怀表，中间实际推理；早期部分匹配未抢占后部完整词，第一片段逐字等于原文前100/总600字符窗口，包含完整emoji。两个工具结果来自同一开场消息。三次正文请求及一次独立Director，正文26字、completed/stop/三候选，delta/落库/刷新/UUID回放一致，工具步骤导出及占用释放通过。
- Gateway四条完整请求/响应、app/task/签名username、原生工具顺序与三候选逐字等于JSON均核对；Director无tools/tool_choice，开场原文保留。临时角色/会话2/2清理，全局设置未变，私人历史未改。160字query、扩展区汉字误命中和希腊文组合边界以本地检查为证，本批不冒称它们均已诱导生产模型验证。

证据位于忽略目录`apps/tavern/.local-visual/excerpt-boundaries`及Linux`2026-10-04T16-52-22.028Z`。后续仍依实际样本优化，不新增读取工具或服务依赖。

## 同一来源的多片段检索（2026-10-05，已上线）

长消息连续检索误判已复现并修复。首查铜钥匙，再查同一成功版本后半段银怀表。第二片段有效，旧来源身份守卫仍报工具无进展。合并继续按来源去重，进展身份加入片段正文；不同query返回同一片段、相同query重复仍停止，不更改来源/版本隔离和检索上限。

- 新增失败用例在修复前明确报工具无进展；修复后agent/index相关96项检查通过，覆盖新片段、重复片段、旧/失败版本排除及原生工具追加。另检查正常正文与三候选、持久步骤/UUID回放/占用释放。
- 真实workerd/SQLite模型夹具串行检索同一长消息两处细节成功；两步骤与锚点落库，重启及UUID回放正常。固定Linux28流程84图通过，81图逐像素一致，桌面世界书dark/error及角色库dark的24/27/1像素既有差异保留基线；设备模拟不是真机。Architect代码复核无阻塞。
- [PR #56](https://github.com/hasbai/financial/pull/56) head `212e9d9a520adb31820a941eeb8c737b987df86f`，Check `37217269897`、Tavern `37217269939`、Blog `37217269966`、Zboard `37217269926` 各一次统一等待，八项必需状态成功，包含最新main后squash `98c46133f62aa4ae2ca6e7960475720bb923341b`。
- main push自动Build `5fec1656-83b5-4053-aca1-5b36aec4115b` success，push_event/main/commit_hash匹配；deployment `3533c87e-4883-41e8-87a0-c1332f250a15` 的 version `0b271589-90d8-4e8c-b2ac-5497b62d5434` 流量100%，health200版本一致。没有手动部署。
- 真实Universal Login/PKCE/JWT请求 `2cc1e030-7f80-49ef-afdf-f0b5d90a5ba4`，模型依次调用铜钥匙、银怀表两次search_memory，中间实际有工具结果后的推理；最终正文请求带同一成功开场消息锚点的两个不同片段。三次正文请求、一次独立Director，正文24字、completed/stop/三候选，delta与保存一致；两步骤导出、刷新与UUID回放、占用释放通过，开场原文保留。四条Gateway完整请求/响应及app/task/签名username归属核对，候选逐字等于聚合JSON，Director无tools/tool_choice。
- 临时角色/会话2/2清理，全局设置未变、私人历史未修改。首次验收在Auth0请求20秒超时，未创建资源；公共Auth0接口与health200后普通登录重试成功。重复片段无进展、失败版本和分支隔离以自动化为证，本批未另诱导线上模型失败或跨分支检索。不冒称全场景可靠。

本批真实验收证据位于忽略目录`apps/tavern/.local-visual/fragment-progress`，无Token；Linux审阅记录为`2026-10-04T16-30-08.065Z`。持续迭代仍按Agent方案中实际样本与验收条件推进，不因此新增read_memory、候选重试或模型服务。

## 会话DO清理与梗概分工（2026-10-05，已上线）

按用户要求，删除会话先持久化清理意图与alarm，确认D1删除标记并释放世界书绑定。再await deleteAll原子清空对应DO私有存储与alarm，成功后才返回；失败由同一意图、重复DELETE或alarm恢复。

构造函数不建表，删除后旧请求不能重建；正文/body与capacity准备阶段的迟到生成返回404，生成收尾未结束仍409。D1删除标记永久阻止旧来源复活，DO不再永久保留tombstone。实例随运行时关闭释放，不声称内存立即销毁或D1旧迁移来源物理擦除。

独立整体梗概接受可靠非空结果，不要求短来源的总结必须更短；仅构建局部使用宽松条件，正文/Director局部压缩及旧梗概递归缩容仍要求缩短并检查进展。解决上一批短开场导致候选跳过的真实样本；不增加重试、模型入口或迁移。

- 139项相关检查通过。真实workerd/SQLite验收deleteAll后无业务表/alarm，重启、重复DELETE、旧生成及读写不能重建，其他会话正常；本地空SQLite基础页显示4096，不把该指标当作Cloudflare计费存储或声称0字节。自动化另覆盖D1/deleteAll失败、两阶段恢复、body/capacity等待竞态、收尾409。固定Linux28流程84图通过，81逐像素一致，桌面三图24/27/1像素既有差异保留原基线；设备模拟不是真机。
- [PR #55](https://github.com/hasbai/financial/pull/55) head `3afc9785f7b78ecd2dcd90ee7fcc57a6bb945e11`，Check `37215647759`、Blog `37215647688`、Zboard `37215647618`、Tavern `37215647620` 的八项必需状态成功，各一次统一等待。包含最新main，squash `962e4c718cfea7a0133d5d04eb494b9b2f6aaaa1`。
- 自动Build `70e8a9ac-99a9-4603-9504-1a1c56244ad2` success、push_event/main及commit_hash一致；deployment `544c90e0-2a72-4e22-9a59-ff971dbfa022` version `5238821f-c5ed-4e2f-9730-b02c6379f704` 流量100%，Node fetch health200同版本。没有手动部署。
- 真实Universal Login/PKCE/JWT三轮正文13/12/25字，均completed/stop/三候选、刷新及UUID回放一致。短开场1字，第二轮整体梗概26字且Director实际发起并返回三条，日志 `01M43VAFCT75HRCKPTYQCEMPGQ`；混合回合 `e40574e9-8ac4-43ea-b251-a6e7dac9d8b2` 两次正文、两次真实BGE-M3，三来源包含最新用户更正与世界书锚点。独立Director未带tools/tool_choice，完整payload/三项metadata核对通过。
- 线上DELETE及重复DELETE为200；删除后GET/export/PATCH/generate均404，列表不含目标，另一临时会话原文不变。临时两会话/世界书/角色4/4清理，全局设置未变，私人历史未改。生产故障注入与生成等待删除竞态未另诱导，以自动化/workerd为证。
- Cloudflare账户级namespace对象列表未反映刚创建的临时对象，不能可靠关联其hasStoredData变化，未声称这层直接物理观测通过。首个验收脚本在身份关联失败后的清理阶段，错误引用尚未创建的对照会话。目标会话已删，遗留临时角色随后清理；修正为不依赖该列表的应用链路验收后通过，无业务代码/CI/部署重跑。物理清空契约与运行证据以上述deleteAll/workerd结果为准。

本批证据位于忽略目录 `apps/tavern/.local-visual/delete-synopsis` 与 `mixed-recall/delete-runtime-final.log`，无Token。当前方案与后续有条件迭代见Agent文档，下面保留各历史阶段证据。

## 架构对照与混合检索（2026-10-04，已上线）

对照固定提交的 DSH Tavern/NextTavern 后，修复历史前三条吞掉世界书结果的问题。另修复非法/重复工具调用先发起外部索引/向量请求的问题。两源有命中时保留已召回历史中的最新两条和最优世界书一条，按完整来源身份去重；工具调用整批纯校验后才外部检索。当前 Director、调用次数与摘要契约同步方案。后续按锚点读原文、候选独立恢复及后台状态结算的收益与验收条件见 Agent 方案。

- 相关97项检查通过；workerd/SQLite隔离资源的导入、停止、重启、回放、分支与删除通过，模型为夹具。固定Linux28流程84图通过，82逐像素一致，桌面两图24/1像素既有差异保留旧基线；不声称真机。
- [PR #54](https://github.com/hasbai/financial/pull/54) head `10cc5d0e80dbfd173225843c421efa6845bde972`，Check `37213607412`、Blog `37213607370`、Zboard `37213607364`、Tavern `37213607388` 的八项必需状态成功，各workflow一次统一等待。Squash `cc10af8cd7a362235a2944beb0d281cfe4bbf6a0`。
- 自动Build `dce288dd-c293-4b75-8465-1ea08197450e` success、commit_hash一致；deployment `cd3b9c67-8bcd-4d1b-a40a-ba168454cbbb` version `5a116599-423f-4648-8959-f81fd88dd9e7` 流量100%。Node fetch health200同版本；另一个客户端403未外推为全站保护。没有手动部署。
- 真实Universal Login/PKCE/JWT三轮正文24/23/70字，均completed/stop、刷新与原UUID回放一致、占用释放。混合回合 `b6c7bb88-a177-4ba8-9606-49b7b7fc8360` 两次正文请求/两次真实BGE-M3请求；三条结果同时包含最新用户更正和带book/revision/entry的世界书原文，并实际进入原生工具续轮。独立Director无tools/tool_choice，三候选逐字等于Gateway JSON，六条完整日志与三项metadata一致。
- 准备历史时第二轮候选为空。短开场的整体梗概长于来源，被正文压缩的严格缩短校验拒绝，未请求Director；正常正文保留。第一轮与混合回合各三候选。

  此现象保留为下一轮梗概与压缩分工改进证据，不声称候选全场景可靠。首次验收脚本错误要求准备轮必三候选而提前退出，临时2/2资源清理；按现有0/3契约纠正脚本后完成检索验收，临时3/3资源清理。全局设置未变，私人历史未修改。

证据位于忽略目录 `apps/tavern/.local-visual/mixed-recall`，不包含Token。本批真实非法工具/重复工具零embedding未另诱导生产模型，以生成链路自动化为证。

## Director 与整体剧情梗概（2026-10-04，已上线）

按用户最新要求替换完整前缀候选：Director是独立TypeScript模块，system只保留候选协议；核心卡片、用户persona、系统故事约束、整体剧情梗概、本轮最新state与最近四条纯剧情作为JSON数据。工具定义/调用/结果、正文投影、世界书全文与作者扩展不进入Director。三条choices使用严格JSON Schema，服务端完整stop后三条原子校验；无效/length/摘要故障保留正常正文、空候选。

整体梗概独立于正文checkpoint，使用每会话DO SQLite派生缓存。按版本/角色/正文指纹校验，复用最长有效覆盖，增量总结窗口外剧情。短会话不额外总结。来源变化/分支不会继承未来事实；近期超限时完整摘要而非截尾，原历史与正文摘要/投影保持原样。具体契约见模型设置文档。

本地121项相关单测、定向TypeScript和diff检查通过；真实workerd/SQLite隔离资源验证存储/停止/重启（模型为夹具）。固定Linux28流程84图通过，82图逐像素相同，桌面两图仅1/24像素既有噪声，保留旧基线。

标准与反向提示两次真实Gateway Schema探测均HTTP200/stop/恰三choices，日志`01M43J0BNBC073WSGW59ESPFX6`与`01M43J3X6GMNCG8K7EVVTGYMVK`；真实JWT读取settings为200。Architect最终代码复核无阻塞。PR完整CI、自动部署与完整应用回合已完成；此前下方完整前缀样本仅为历史实现证据。

本批最终证据：

- [PR #52](https://github.com/hasbai/financial/pull/52)，head `323e62feb9c0e27de4d3f99b7657cad4b487a545` 八项必需检查全成功；Check `37207813262`、Blog `37207813260`、Zboard `37207813265`、Tavern `37207813266` 各一次统一等待。包含当时最新main，squash `2dfd6001727c1dc5fde5d02bfa96f3545e7f26ac`。
- main push 自动Workers Build `ebc5c7d7-6b40-4ec5-8020-1cd5cc9e32af` 成功，commit_hash与squash一致；线上 `/health` version `2eec2286-5dcd-4a71-8989-9ef998578ae5` 与100%部署一致。没有手动部署。
- 真实Universal Login + PKCE/JWT下，状态工具更新、整体梗概、重生成三段均completed/stop/三候选。正文delta与落库一致、刷新与原UUID回放一致、占用释放。Director实际请求仅system/user、strict JSON Schema、没有tools/tool_choice，最新state与最近四条纯剧情正确。第二轮窗口外整体梗概非空；重生成复用有效梗概，无重复摘要请求。
- 三段Director输入/输出tokens分别440/111、484/94、484/87，对应日志 `01M43M7GTWXA7KMM8CJABK4X69`、`01M43M834QR5Q8F1YVRP3D5RV4`、`01M43M8JNA4D6TXEM778G9MZ0D`；三条候选逐字等于Gateway聚合JSON输出。完整payload/三项metadata归属验证。样本不作为P95或全场景速度承诺。
- 两次初始验收因脚本误读Gateway聚合字段失败，已分别清理2/2临时资源；修正为delta.content与streamed_data终态后完整验收成功。未改业务代码或重复CI/部署。最终临时角色/会话/分支3/3逻辑清理，用户全局设置不变，既有私人正文未改。证据保存在忽略目录`apps/tavern/.local-visual/director`，无Token。
- 自动化包含取消、摘要故障/迟到保存拒绝、context恢复与capacity传递、长单条情节压缩及正文checkpoint隔离；本批线上真实模型未另跑停止或超限压力，不将自动化冒称线上或真机验收。

## Agent 状态、工具与检索（2026-10-04，已交付）

已实现版本绑定状态快照、search_memory/update_state原生续轮、中文旧事实与更正检索。另实现最新实际模型投影复用、世界书版本分块及关键词+向量渐进检索。兼容D1迁移0008仅增加分支恢复seed；旧消息/ID保留，DO增量新表不覆盖既有对象。停止、失败重生成、中断续写、分支不提交未来事实。

RP真实Gateway原生update_state→工具结果→正常正文已通过；BGE-M3真实REST+default Gateway返回HTTP200、2×1024维、2.23秒，日志`01M42R0RB18DT634MGKFADYCXS`。本地remote binding超时不算应用成功，生产原生绑定验收已完成，见下表。

101项聚焦核心、存储和生成检查覆盖工具0/1/2轮、非法/重复/无进展、取消、失败重生成、工具后length与长正文压缩。另检查候选前缀/禁工具、旧DO升级与分支恢复；Svelte零错误/零警告，真实workerd SQLite工具状态/重启/分支通过。固定Linux桌面/iPhone WebKit28流程84图通过，82图逐像素相同，2图仅1/24像素噪声低于既有50容差，保留全部旧基线。

0008已先在隔离云D1验证旧消息/ID，再应用生产。14条会话与44条迁移来源消息数量保持，nullable seed新增成功，隔离数据库删除。此前0006/0007真实DDL已存在而Wrangler迁移记录缺失，核对原定义后仅补登记，未重放ALTER；Wrangler回读无待应用迁移。

| 层级 | 本批最终证据 |
| --- | --- |
| PR/CI | [PR #46](https://github.com/hasbai/financial/pull/46)，head `6e766c252f2785b13a2b4b5205e4cfb4f5416404`含当时最新main；financial/blog/zboard/tavern共八项必需检查成功，squash main `cd4c969dd198eeb5c56c7992a53c0f590e889bfd` |
| 自动发布 | Build `146446a9-e4e5-4043-8613-b5e40666207c` success且commit_hash/main一致；deployment `9926743a-cbb9-4aa9-ae3b-4b1866482459`，version `c9e82d9c-de3b-4799-b3d8-5fd064c7c080`流量100%，health200匹配；没有手动发布 |
| 真实JWT/工具 | 共享Universal Login+PKCE身份；正常、state、memory、连续第三轮、切换/返回、重生成与世界书均completed/stop、三候选、原UUID回放与恢复一致、占用释放。state实际update_state，memory实际search_memory；两工具样本`47a69eba-cd34-4feb-a550-5a9d16debabf`真实search→结果→update→正文→候选，共四次RP请求 |
| 状态版本 | 已提交场景/事实刷新一致；重生成保留正确前态；编辑首用户消息的分支状态为空，无未来事实；JSONL含版本快照与工具步骤。真实stop请求`9408fd38-6800-42a8-817b-7895a338a9fa`先暂存update_state再保存89字中断正文，after=NULL、会话状态未变；续写`8e4490ed-4999-432c-b4e9-b8044c7f3a85`保存1291字、前缀逐字保留、scene最终正常提交 |
| 世界书RAG | 请求`216b2c84-c5cc-40ca-896a-c492d4d01441`经真实search_memory召回带book/revision/entry锚点的入口/门牌原文；三次RP与两次真实BGE-M3请求，正文66字、三候选、0错误。生产原生AI绑定、1024维校验与完整Gateway请求/响应、三项metadata均通过；此前本地remote binding超时未计成功 |
| 候选与归属 | 八个成功样本实际候选messages原前缀、tools schema逐字段恒等，tool_choice=none，正文/候选分离。Gateway完整payload与app=tavern/task=roleplay/签名username一致，RP与embedding同归属；没有候选状态工具调用 |
| 双会话/停止 | 两会话同时发送均完成，7.410/9.070秒；另一会话生成期间取消成功、双方占用释放，取消后新生成4.878秒完成。被取消请求未留下Gateway记录，因此未声称已精确观察其进入GPU排队，也不将有限样本当全局公平调度证明 |
| 清理 | 三批临时资源5/4/2个均通过删除API逻辑清理；另一个精确字符串断言失败的探针4资源也全清理（模型写“铜钥匙在旅人手里”，属等价表达，不是状态丢失）。全局设置未变，私人历史未改，D1迁移来源与DO tombstone保留 |

### 缓存与性能实测

| 场景 | 首个正文请求输入/缓存tokens | 首次预填耗时 | 候选输入/缓存tokens | 候选预填耗时 |
| --- | ---: | ---: | ---: | ---: |
| 状态更新 | 701 / 0 | 1.198s | 1170 / 1094 | 0.551s |
| 下一轮记忆检索 | 1183 / 0 | 1.611s | 1854 / 1778 | 0.537s |
| 连续第三轮 | 1863 / 0 | 2.136s | 1973 / 1898 | 0.536s |
| 切会话后返回 | 1983 / 0 | 2.231s | 2073 / 1997 | 0.530s |
| 世界书工具后正文 | 1503 / 1259 | 0.506s | 1629 / 1554 | 0.524s |

同轮工具→正文/正文→候选追加缓存成立，候选仅新增约75–76个prefill tokens。跨回合首请求KV缓存仍为0，没有宣称本批解决GPU缓存回退。真实/apply-template与/tokenize分别确认跨回合共享1099/1783 tokens（新请求约93%/96%），证明模型投影及模板前缀稳定；tools none→auto没有破坏前置模板。

线上服务b11200-81bc6b83f、单slot、运行32768。候选完成后下一轮需回退到候选之前的分叉点；[同版源码](https://github.com/ggml-org/llama.cpp/blob/81bc6b83f/tools/server/server-context.cpp#L3217-L3383)在recurrent/SWA缺少合适checkpoint时将n_past归零，高度匹配实测，仍为推断，缺对应服务端日志不能写成确诊。应用保留正确剧情/候选隔离，不强加slot_id或将候选事实塞进下一轮来换缓存；模型服务checkpoint诊断属后续性能工作。

全部请求/恢复/日志/模板及清理证据保存在忽略目录`apps/tavern/.local-visual/agent-tools`，未保存Token。架构复核确认所有确定P1已修复；手机为WebKit模拟，不冒称真机。Agent本批计划实施与发布完成，后续模型服务优化不伪装为已解决。

2026-10-03。线上入口：[tavern.hasbai.xyz](https://tavern.hasbai.xyz)。完整方案、来源依据与后续路线见 [TAVERN.md](../ARCHITECTURE.md)。

## 已交付

- `apps/tavern`：角色库、发现、世界书、持久对话和设置，复用 Svelte 5、Luma、Auth0。
- CCv1/v2/v3 JSON、PNG chara/ccv3、CHARX与独立世界书导入；原文件私有保留、原卡与标准 JSON 导出，未知扩展保留但不执行。
- 世界书关键词/副关键词/常驻/扫描深度/递归/优先级/排序/预算，用户 persona、角色、世界设定与历史提示组装。
- D1/R2、JWT superadmin访问、会话快照、生成幂等与锁、SSE、部分内容落盘、停止、重新生成、编辑分支、JSONL导出。
- TheatreLM原始5011条，经本轮质量隔离后5002条可用；revision `eb8597aec4e3e114b2d28b86c3e2496dd48c5af3`；worlds.json SHA256 `6acddc549996246cca97a3bda0560b9fbafe188920703815adeb33d3459b165a`。来源、署名、许可和转换标记随角色保存。
- 首版曾固定 `AI.gateway('default').run` 调用 `dynamic/rp`（compat/chat/completions）；2026-10-08代码已迁原生AI.run，最新验收限制见[原生动态路由绑定](AGENT-ITERATIONS.md#原生动态路由绑定2026-10-08已发布线上验收未通过)。固定RP白名单，不接受前端覆盖模型或密钥，无应用隐式重试或备用模型。

## 首版验收证据（修订前）

| 层级 | 已验证结果 |
| --- | --- |
| 核心与类型 | 28项核心测试通过，覆盖格式、安全边界、世界书/Prompt/SSE、JWT、幂等及历史锁。另检查原子绑定/删除/分支、过期恢复、空闲上游停止/断连及非流拒绝；Svelte diagnostics 0 errors / 0 warnings |
| 固定 Linux 浏览器 | 桌面 Chromium 与 iPhone WebKit 共14项流程、68张已审阅基线；5页面、7截图场景、零豁免，覆盖正常、空数据、错误、加载、深色、窄屏、键盘与延迟停止恢复 |
| 生产 D1/R2 | 两个迁移已实跑，目录5011条与release revision核验；专用JWT下搜索、安装、会话保存和私有R2原文件下载均成功 |
| 完整目录分页 | 第418页返回7个角色、无下一页；末页角色安装成功，不仅验证前1200条 |
| Auth0 | 独立 audience `https://tavern.hasbai.xyz/api`、增量回调、Action `2e74040a-2123-4721-8f4b-c4c3367eaf6c`；普通Universal Login + PKCE实际签发用户JWT，并通过Worker验签与权限检查 |
| 真实模型 | 生产应用SSE HTTP200、非空delta、done、无error；恢复查询得到assistant completed（77字符）；停止落aborted、会话锁释放，再次生成成功 |
| 测试数据 | 本次生产验收创建的会话、两张安装角色及先前失败探针会话均已清理 |
| PR与CI | [#26](https://github.com/hasbai/financial/pull/26) 和 [#27](https://github.com/hasbai/financial/pull/27) 最新head八项必需检查全成功，包含当时最新main，均squash合并 |
| 发布提交 | `c059b0c06268537305510a9ff8ed17f6bf0e49ce` |
| Workers Builds | Build `39390315-99e2-42fb-8192-5b10714886f9` success，固定main及上述提交；version lookup与deployment确认版本 `5d7dacf7-c40c-4e19-852a-baa9590e01cb`、权重100%；Node fetch `/health` HTTP200且版本一致 |

## 发布过程与兼容边界

旧Gateway universal compat绑定在生产返回500，最终改用2026-10-02官方文档支持的原生动态路由绑定，真实应用推理已通过。修复提交的两次Builds环境初始化超时，未进入clone/install/build/deploy；成功与失败trigger快照一致，无其他monorepo构建占用。通过官方Builds API对同一main提交串行重试，第三次成功；没有手动Wrangler发布，也没有通过假提交重跑CI。

Chub/CharaVault探针403；Chub保留失败状态与适配器，未声称该源搜索安装已验证。Risu没有公开搜索契约，不接未文档化接口。Dataset Viewer搜索超时/500，改为完整固定版本目录。复杂SillyTavern扩展仅保留；后续增强路线在方案中单列。

本地和CI设备模拟不代表真机。合成浏览器夹具仅用于独立dist-e2e，不进入生产dist；真实JWT/API/模型与部署验收分别记录。

## 使用反馈修订（2026-10-03）

六项全部交付：统一雪花标识；默认Chub上游热度/时间/分类；隔离9条损坏公共记录（5002可用）；Enter发送/Shift+Enter换行及IME保护；持久终止原因、4096默认与显式续写；收窄阅读列与输入区优化。

具体诊断证据与契约见方案。

| 层级 | 本轮结果 |
| --- | --- |
| 代码 | 39项核心测试通过；Svelte0错误/0警告；续写原轮次超预算明确400且不丢前缀，生成/导出保留终止原因 |
| 浏览器 | 固定Linux桌面/iPhone WebKit22项流程、74张审阅基线；普通严格比较22项通过，50像素容差未改；Enter/Shift+Enter/中文IME、排序分类分页、长对话、异常恢复与续写均覆盖 |
| CI差异修复 | 初次PR仅iPhone编辑弹窗背景差828像素。trace证明消息区滚动21px，弹窗一致；显式定位阅读位置后chat-edit精确匹配原基线，无新增基线接受 |
| 生产迁移 | 0003/0004在本地和生产D1均成功；目录5002、损坏名称0、旧会话1024默认0；私人角色与历史保留 |
| 真实来源 | 用户PKCE/JWT下Chub热度、最新、Fantasy分类和第二页各12条；真实PNG安装/头像成功。TheatreLM第417页10条且无后页，已隔离的2921条不能安装 |
| 标识与头像 | 线上logo.svg与统一原资源逐字节一致；线上CSP精确允许avatars.charhub.io，未放宽为任意远程主机 |
| 真实生成 | 4096预算下角色回复completed/stop、65字；降回1024故意耗尽预算，正文0字但length/error及原因持久化、锁释放，避免静默“完成” |
| 真实停止/续写 | 有限三段对白任务中保存72字，stopped、锁释放；续写到207字completed/stop、前缀保留、无error事件、恢复一致、用户轮次仍1；JSONL保留停止与续写两个版本及原因 |
| 测试资源 | 网络/模型验收新增会话和角色均清理；原有用户安装未删除。分别记录短回复提前完成造成stop竞争409、长任务未正常结束的验收探针。两者未算成功，未据此盲目改应用或隐式重试 |
| PR/CI | [#28](https://github.com/hasbai/financial/pull/28)，最终head e55c7887ac6be8a4d6b6fefe3a2dbfff08087c6a，包含当时main；[Check](https://github.com/hasbai/financial/actions/runs/37111789461)、[Tavern](https://github.com/hasbai/financial/actions/runs/37111789418)、[Blog](https://github.com/hasbai/financial/actions/runs/37111789427)、[Zboard](https://github.com/hasbai/financial/actions/runs/37111789422)，八项必需状态全绿，squash合并 |
| 自动发布 | main d129895eb9fbf7367651dee55e316da8cdc51443；Build31323226-d825-4a20-8ea3-db0e035e3d81成功；deployment2da46eba-0219-4d4d-b196-ad3e76a186fc，version a68f9a43-4900-4900-be39-559184ff54f3流量100%；线上health200版本一致，无手动重复部署 |

续写与普通生成仍受用户预算/175秒期限及上游模型影响；达到限制时持久显示原因，不能宣称无限输出。原始用户短回复未记录finish_reason，具体终态无法重建；同角色/输入复现与确定的终态误判缺陷已修复。设备模拟不等于iPhone真机验收。

## 模型配置与续聊候选（方案历史）

2026-10-03 已完成 [方案](../MODELS.md)，尚未修改应用或生产数据库。方案补齐参数默认值、默认关闭思考及白名单模型选择，首个为 RP 动态路由。同一次 roleplay 正文后输出最多三条用户视角候选，点击发送，避免再次预填充；短上下文按上游明确能力反馈协商，HTML 架构图见方案。真实 RP 参数能力、关闭思考及候选延迟仍待验收；不能把现有过滤思考输出算作已关闭思考。

## Gateway 归属日志与 JWT 名称（2026-10-03）

原因已定位：线上 Worker 配置为 default Gateway，应用调用 `dynamic/rp`；原代码 `collectLog:false` 禁止整个 Gateway 日志，不是绕过 Gateway。修复启用日志、独立禁存 payload，服务端统一 `{app:"tavern",task:"roleplay",username:实际账户名称}`，eventId 关联 requestId。用户名由 Tavern 专属 Auth0 Action 写入签名 JWT，前端携带 Access Token，后端验签后直接读名称；没有逐轮 Management API 或 userinfo 调用。旧 Token缺名称时生成前明确重新登录，不使用角色名或 ID。

Auth0 Action 已先发布并回读匹配；真实新 Token包含“时阅”及原 superadmin，其他 audience 的 Action输出不变。相关 auth/生成36项测试和轻量检查通过。参数开关、同次候选与能力预算仅更新方案；HTML 四视图、桌面/390px/深色和16K/32K/unknown预算交互已检查，无JS错误或横向溢出。

发布与真实应用验收已完成：

| 层级 | 本轮证据 |
| --- | --- |
| JWT | audience限定 Action先部署且回读源码一致，实际Token签发username“时阅”；生成前直接取签名claim，不查资料接口 |
| 聚焦检查 | auth/生成36项、聚焦Worker TypeScript检查、差异/链接检查通过；HTML四视图、桌面/390px/深色、16K/32K/unknown预算交互通过 |
| CI | 初次仅测试Mock类型过宽导致typecheck失败，显式收窄AiRun修复；[Tavern](https://github.com/hasbai/financial/actions/runs/37116178794)、[Financial](https://github.com/hasbai/financial/actions/runs/37116178790)、[Blog](https://github.com/hasbai/financial/actions/runs/37116178747)、[Zboard](https://github.com/hasbai/financial/actions/runs/37116178758)最终8项必需状态全部成功 |
| 合并/发布 | [PR #29](https://github.com/hasbai/financial/pull/29)，main `46df3eed2261bc7819e6793606f8faaded845e36`；自动Build `9ca58891-6a5c-4738-b73c-236a1476407e`的commit_hash一致；version `d1dcdad0-ca41-47ea-9df7-8f94feca7bf8`流量100%，health200版本一致；无手动部署 |
| 真实应用 | 请求 `c1ea8534-0978-464a-a1ea-3ddac5cdf36e`，HTTP200、completed/stop、正文3字、0error、恢复一致、锁释放；故意传前端伪metadata不能改变服务端归属构造 |
| 返回模型 | Worker事件记录 `@cf/google/gemma-4-26b-a4b-it`；仅记录真实返回标识，不据此假定RP所有路由分支或上下文能力 |
| 测试数据 | 仅删除本次创建的临时会话与角色，原用户数据保留 |

该阶段Gateway读取权限返回403，尚未直接核实后台日志；后续权限已补齐，三项metadata与payload禁存核验见下方当前交付。原生binding当前未返回可用event_id，因此按时间和数量核对，不声称逐条requestId精确关联。

## 模型与同次候选首轮实现（2026-10-03，后续简化取代）

共享参数默认值/校验、全局与会话设置、默认关闭思考、一次生成正文和候选已实现。另实现D1 nullable候选元数据、刷新和UUID回放、候选原文发送及草稿保留。移除固定窗口，通过上游明确context_window、route version、schema、五分钟缓存/CAS与归属明确的超限反馈校正预算，未知能力拒绝推理；16K/32K用例保留当前输入及最近完整问答，按预算裁世界书/旧整轮，不额外摘要调用。

Gateway Read已实证：日志`c09aa204a95e7c5cd4b525557e422d87b6a66f72e32d5d76f664c61165dba2cf`包含三个正确metadata，request/response为空，独立正文接口404/7002。当前RP唯一模型为Workers AI Gemma4，官方API返回context_window=256000，schema支持布尔enable_thinking和Top P/惩罚，未支持Top K；不把成功usage当窗口。仅RP改为零重试/170秒超时并回读，版本2230f986-c794-4ac8-9a0f-a1cbbbf35f01，其他路由保持原配置。沿用用户授权的AgentToken配置服务端能力Secret，不进入浏览器。

隔离本地D1五个迁移通过、聚焦生成/协议/能力检查通过；固定Linux桌面/iPhone WebKit28项流程与82张截图通过，受影响截图已审阅导入；保留三张与本次UI无关的原基线（1/6/24像素差低于既有50容差）。相关核心/协议/能力/生成69项通过，聚焦Worker类型和Svelte0错误/0警告。

两次初始视觉失败分别来自测试中隐藏主题按钮、候选扩展阅读区的212px跟随问题。修复后原≤1px断言通过，未放宽容差。本地真实Worker探针受remote binding/网络超时影响，未计作真实模型验收；生产0005兼容迁移已成功（3条语句，旧记录与ID保留），PR/CI、自动发布和真实模型仍待完成。

## 参数透传与统一UI修订（2026-10-03）

[PR #30](https://github.com/hasbai/financial/pull/30)八项必需检查成功并已发布：main b2ac3a091f17da59380fd8a9c2aad6ebe8ea4c5c；Build 3c78240d-8da2-405c-bdb3-f44158b8bb6c成功；线上version477e0c5a-5782-4b6b-a590-2cde78521358，health200一致。0005候选迁移已兼容应用，旧记录保留。

用户调整RP为本地custom-pc/qwen3.8-27b后，原模型/schema门槛报“模型路由已变更”。按用户要求删除这套准入设计：RP始终可用，参数直接透传；上下文只读探测后台刷新，失败不挡对话。运行时不再访问管理API或依赖管理Token。动态路由Workers binding是唯一推理入口；metadata仍为app/task/真实username，无自动重试。

财务既有Notice提取至packages/ui，财务原入口复用、输出保持一致；Tavern登录、页面和弹层错误及设置保存通知统一引用。AGENTS已记录“禁止过度设计”“尽量复用统一UI”。当前修订相关测试67项通过、Svelte零错误/零警告、聚焦Worker类型检查通过；固定Linux28项流程82张截图通过并审阅导入（2026-10-03T11-46-36.260Z）。

保留1/24像素无关渲染差异的原基线。HTML四视图、390px/桌面/深色与16K/32K/unknown交互无错误。架构复核通过；PR/自动部署和真实本地模型验收待完成。

实际本地/apply-template（不执行推理）验证：关闭参数预填充空think块；单独enable_thinking=true会受服务端默认reasoning_effort=none影响报错。显式none/low配合开关后，两种模板均HTTP200，开启预填充开放think。请求指定deepseek解析格式分离思考与可见正文。真实生成仍在发布后验收。

## 当前交付验收（2026-10-03）

[PR #31](https://github.com/hasbai/financial/pull/31)八项必需检查全部成功，包含最新main并squash为`ed1180fb066b8f7d43b36b849374122872c87288`。自动Build`31bc671c-936f-4770-a861-b3dc570cbe97`成功且commit_hash一致；deployment`04086369-faa3-4083-b2ac-492cb5623b24`、version`340ea9f6-e895-4e1c-b802-346bb88ef980`流量100%，health200版本一致；无手动部署。

真实JWT应用验收：关闭思考请求`1aeb577a-cfa7-4b85-92f5-704516313304`正常completed/stop，正文9字、3候选；开启请求`dec6ee7c-2a96-4e1e-a2d5-1568556cf81a`正常completed/stop，正文12字、3候选。两轮均0error、刷新候选一致、原UUID回放未重复生成、锁释放。候选原文发送请求`0abe609b-d0ce-4b5a-9cec-187869d3faa0`正常完成、第二条用户消息逐字一致。

实际设置包含TopK20、TopP0.9、两项penalty0.1。浏览器夹具已独立验证点击发送、双击保护和草稿保留，未将API探针冒称真实浏览器点击。临时2会话/1角色已删除。

Gateway同一验收时间段恰好3条Tavern日志，HTTP200、模型qwen3.8-27b，均为`{app:"tavern",task:"roleplay",username:"时阅"}`，伪客户端metadata无效，request/response未存正文。日志ID依次为`9656cf39015064612d61351b689b84cba1d2253406470edfbd76672d18a2564a`、`a0d913e828b2d16dd9a7719af1d02501e34a6b066f62fbb585087415ee5a8626`、`cb6842555202ad1377cc1dfea3dc1878f1801d4b0568e72f8e077fc8e4a239a9`，output tokens86/95/308。与实际3次生成数量一致；刷新和回放未产生额外日志。当前原生binding日志event_id为空，按时间及请求数核验，不声称eventId已在后台确认；应用仍发送该选项。

单样本关闭思考首正文18.46秒、正文最后增量18.69秒、候选就绪不晚于总耗时22.68秒；开启首正文6.98秒、总耗时12.18秒。冷启动/预填充缓存状态不同，不能据此比较思考开关延迟或承诺速度。实际模板验证和请求参数、token用量与生成终态分别记录，未把过滤reasoning_content当关闭证明。

上下文自动化验证16K/32K、未知模式及后台刷新/更小明确上限两种并发顺序。实际上游/props曾HTTP200、n_ctx32768且单slot；发布后的应用模型选项仍为contextTokens:null，随后上游/props、/v1/models、/health均HTTP502。

因此真实运行时容量发现尚未成功，不把节点侧32K探针当作Worker已发现容量；探测失败不会阻断聊天，保留核心设定、最近完整问答和当前输入，省略世界书及更早历史。上游GET异常原因未定位，接口恢复后后台自动重新探测。应用修复与模型服务当时可用性分开记录。

## 统一Auth0与完整Gateway日志修订（2026-10-03）

用户明确要求北极小站Auth0配置统一，禁止Tavern audience限定，并要求查看完整模型请求。当前修订移除Tavern前端audience覆盖与专属claims，复用packages/auth公共配置、顶层role和公共username；原财务role映射保留，公共名称签发不限制Tavern audience。旧Tavern Action在兼容发布后解绑，setup脚本不再创建独立API或恢复旧Action。

Gateway原payload=false解释了只有metadata没有完整请求；现改为true，保留三项metadata、动态Workers binding与单次调用。上方旧记录中的payload禁存及Tavern专属鉴权均为历史行为；新版本真实JWT及完整请求/回复日志验收已完成。

发布前已先更新既有financial role Action并回读源码一致，原5个绑定顺序保持，旧Tavern Action暂保以兼容当前Worker。普通Universal Login+PKCE签发共享audience JWT、顶层role=superadmin、公共username=时阅，无Tavernclaims；该JWT只读财务Data API HTTP200，原财务映射有效。auth/生成40项及Svelte/聚焦Worker类型检查通过；Linux28流程82截图通过，80张逐像素一致、2张在既有50像素容差内，无有意UI变化、不替换原基线。架构复核通过。

| 层级 | 最终证据 |
| --- | --- |
| PR/CI | [PR #32](https://github.com/hasbai/financial/pull/32)八项必需状态成功，包含最新main并squash为`aa9c77c7c734fd4380fee8291d55447aa71eb230` |
| 自动发布 | Build `f1dad52d-bac7-45ac-b395-ed5f0c61cfc9`成功且commit_hash一致；deployment `2a427dd7-437d-483a-b8f5-cfcdc762249a`，version `dac7a0fe-42db-4001-8646-63c37c17c1e5`流量100%，health200版本一致；无手动部署 |
| 共享认证 | 发布后setup脚本成功，现有共享Action已部署且源码一致；旧Tavern Action解绑后保留signup profile、eastmoney login claims、financial role、zboard role四个既有绑定顺序。新PKCE JWT采用公共配置的既有共享audience，role=superadmin、公共username=时阅，无Tavern专属claim；没有创建新API或逐轮查询管理后台 |
| 真实对话 | 请求`f2ca205e-6a08-4ed3-a2c1-d6be3c40f757`正常completed/stop，正文8字、3候选，约10.73秒；临时会话与角色均删除，角色列表读回本轮探针剩余0 |
| 完整日志 | 日志`b55dec311b5829f30a589e38b9417fedb39c708a4fc6a4bcf60af387be83ab17`，创建时间2026-10-03 20:33:33（Asia/Shanghai），HTTP200，metadata为`{app:"tavern",task:"roleplay",username:"时阅"}` |
| 原始正文 | `/logs/{id}/request`和`/logs/{id}/response`均HTTP200，1193与25289字节，分别与日志记录的request_size/response_size完全一致。完整请求含3条messages及验收输入，Top K20、Top P0.9、关闭思考；完整响应为SSE，包含正文、3候选、stop及`[DONE]`。原始正文仅保存在本地忽略目录，不提交用户内容或Token |

当前Cloudflare日志详情的`request`/`response`摘要字段为空，但`request_head_complete`/`response_head_complete`为true且正文下载接口可读，因此不能仅凭两个摘要字段判断未保存payload。新日志已有完整正文，旧版本禁存payload的日志无法补回。原生binding仍未返回可用event_id，本次通过完整正文中的唯一验收输入和requestId标记核对对应日志，不声称后台event_id已确认。

## 对话界面、完整历史与聚合日志修订（2026-10-03）

按ChatGPT式交互重做：右侧用户气泡、无气泡角色正文，消息姓名与头像隐藏；圆形箭头发送/方块停止，输入框单行起步、自动伸展至200px后滚动，清空后复位；复制、编辑与最新回答的重新生成置于正文末尾。全局与会话System Prompt可编辑并独立恢复默认，默认鼓励3–6段、约300–600字的对白与场景细节；只升级精确匹配旧默认的设置，保留用户自定义提示和现有会话快照。用户提示不再因角色卡自带提示而被省略。

漏最初消息的根因已确认：未知容量分支只保留最近完整问答。现移除截断，未知窗口保留全部有效历史与激活世界书。已知16K/32K才按容量预算裁旧整轮。候选改用固定独占行`[TAVERN_NEXT]`与最多三行文本，不含UUID、不要求模型输出JSON；请求幂等UUID仍只在API/日志关联字段。增量解析支持跨块/CRLF、去空去重、序号容错与2KB尾部上限，候选仍一次生成、原文点击发送。

真实日志对照纠正了首轮“不能聚合”的判断。Eastmoney `01M3EJXA5KKBWYKD2Q0203BR0P`与`01M3DAPMZJA73Q3H7NM5CAV6EY`均request.stream=true、provider custom-codex、path responses、response_content_type text/event-stream，正文接口返回含完整output及streamed_data的聚合JSON；`01M3EVE04H7R116E32YG9VVJ6X`的Workers AI Chat Completions流同样聚合。Tavern原`AI.run`日志为unknown、/run、application/json，原始SSE未聚合。PATCH只支持metadata不是无法聚合的证据。

直接REST动态compat探针`f69b6587-3eda-4e3d-945a-310f99a5aa7f`HTTP200流式正常，日志`01M410889NVV3EGJQ0VYT4HRFV`识别custom-pc并聚合。Wrangler本地/remote代理预览均超时，取消子进程代理后健康检查仍超时，未把该环境故障当模型失败；经官方edge-preview API直达临时预览，免密钥Gateway绑定请求`75fe9f7f-03b6-483c-9a4e-fe4315ab90c2`HTTP200 SSE+[DONE]，日志`01M410S3TTK0XTPTG314V5WQC5`包含正确app/task/username、完整`choices[0].delta.content`与4个streamed_data块，证明该绑定可用。当时待发布的Gateway universal绑定dynamic/rp已由下方PR #33上线，未绕过路由、无推理Secret、无第二次调用。旧Workers AI阶段的失败与上游issue617一致；本轮测试的是当前custom-pc路由。

相关64项测试、Svelte零错误/零警告、聚焦Worker TypeScript检查通过；固定Linux桌面/iPhone WebKit28流程、84截图通过并审阅导入（2026-10-03T13-33-20.986Z），其中28张为有意聊天/设置变化，2张为新展开输入证据。3张≤50像素无关差异保留旧基线。首轮失败为新增恢复提示按钮造成旧模型重置定位歧义，已明确exact定位，未改UI行为或视觉容差。架构复核通过；PR/CI、自动发布及真实多轮验收待完成。

[PR #33](https://github.com/hasbai/financial/pull/33)已通过八项必需检查并squash为`622cfd494bef51277f8d852fdd8fea09af6eeceb`。自动Build`2baf281f-6720-4fbe-939a-27faa1a753d3`成功且commit_hash一致；deployment`a9d30387-5849-45a1-bd1e-c079fec0158a`、version`dd793d65-c4f1-41e3-85f3-04d860afe0da`流量100%，health200一致；未手动部署。

真实共享JWT两轮正文503/409字、均completed/stop、0error。日志`01M411MKK16P19YQVKCTKN9P8P`和`01M411N3BEJWNW8GASA0Y7ZAKB`均为custom-pc/chat/completions，保存完整聚合正文和streamed_data，metadata为`{app:"tavern",task:"roleplay",username:"时阅"}`，event_id对应各自请求UUID。第二轮完整5条messages保留最初问候与首轮输入。首轮3候选；第二轮模型未输出固定分隔符，0候选，因此继续修正候选指令，不把该轮宣称为候选验收成功。临时1会话/1角色已删除。

## 每轮候选格式修正（2026-10-03）

仅加强固定System指令。每轮（含续写、重新生成）必须完成正文与候选两部分，使用标记加三行候选的静态格式；仍共用输出预算、只请求模型一次，不新增模型调用、伪造候选或解析协议。当前custom-pc动态路由的连续两轮edge-preview日志`01M4127MYRCDQ2B19WTMSQFQAH`与`01M412JKDPH4QTSHNEKDCGZNSJ`，正文523/448字、均3候选，430/341块分别与聚合正文完全一致；第二轮5条messages，首轮System尾部与最终指令逐字一致。

日志正文可能晚于条目入库，验收读取等待payload就绪，不因此重复推理。相关56项测试及diff-check通过；该小改自动发布后的真实应用、持久化和回放验收待完成。模型指令遵循仍可能漏尾部，应用不追加第二次推理。

[PR #34](https://github.com/hasbai/financial/pull/34)八项必需检查通过并squash为`f954b2b3e5b7f6cd028eb673c5157e85811499ca`，自动Build`05d05f2d-581a-4512-a28f-827be5a193b8`成功且SHA一致；deployment`e2e4a49b-8911-4d3b-8f85-e1079642db95`、version`79ea20ee-d08a-4649-bab7-8957385bc3e9`流量100%，health200一致。生产两轮436/509字、3/0候选，仍有续轮漏尾部，未把预览成功当作生产稳定性证明。日志`01M4134BJEC1GT6SVDA45ZEDSV`和`01M4134RDEYHQWVWHWXY3YV111`的完整正文均与应用正文及流式拼接一致，三项metadata正确、event_id逐轮匹配，最初消息保留；临时1会话/1角色清理成功。

架构复核指出此前手组预览与生产在角色内容、连续性规则和采样参数上存在差异。最终小改只在模型请求的最后一条user副本末尾追加固定格式提醒。提醒先计入预算，三种生成模式共用。用户保存/显示/导出原文不变；System仍固定、历史候选不入Prompt、无额外推理。

复用真实失败请求，仅更改提醒。连续三轮5/7/9条messages：日志`01M413GET8A5X0E9DMTJWRAJN8`、`01M413H204D2829Z2N5NP36JP4`、`01M413HFJBGPPEF6DMBJN8W7AG`，正文391/423/537字，均3候选。332/358/396块全部与聚合正文一致。相关68项测试、聚焦Worker类型和diff-check通过；HTML日志路径更新后四视图、1440/390px、深浅主题无溢出或JS错误。最终自动发布及真实应用验收结果如下。

## 最终对话与日志验收（2026-10-03）

| 层级 | 结果 |
| --- | --- |
| PR/CI | [PR #35](https://github.com/hasbai/financial/pull/35)八项必需状态成功、基于最新main，squash为`b11df3b762cf29f00afd01446fa3734219a13608` |
| 自动发布 | Build`6f511ee8-a97e-445c-a133-d0541c2652e0`：push_event/main、build_outcome=success、commit_hash与上述SHA一致。deployment`5380b2ef-9821-4e0f-9285-12a31f94412a`、version`d4003453-7e87-4d64-bf43-e7d2400665e3`流量100%；匿名health200版本一致，无手动部署 |
| 真实两轮 | 共享PKCE/JWT请求`4c02d153-30cf-4b6a-87cb-1a7de3024b58`和`e40f8c1f-da7b-4894-a5a2-e7b2dcf0ab29`，正文354/319字、3/3候选、218/203次delta，均completed/stop、0error；首正文4.51/5.20秒，总耗时12.99/13.37秒，仅为本次样本 |
| 持久化/幂等 | 两轮正文与候选刷新读回一致，用户保存原文不含应用提醒，所有delta拼接等于终态正文；原UUID回放成功、锁释放；同一时间范围恰好两条匹配真实请求的模型日志，无候选补发或回放推理 |
| Gateway日志 | 首轮`01M413Z89CZ8EMDJ32Z3WM89SN`，续轮`01M413ZPHZA5VNWRVHZB69243G`，custom-pc/chat/completions、stream=true、三项metadata=`{app:"tavern",task:"roleplay",username:"时阅"}`，event_id逐轮等于requestId。请求分别3/5条messages，保留最初问候及首轮输入，稳定System不含UUID |
| 完整聚合 | 两条响应均包含完整`choices[0].delta.content`与`streamed_data`，可见正文逐字等于应用保存正文，全部delta拼接等于聚合正文。请求/回复字节分别2407/79582、3568/72675，与Gateway记录精确一致；正文及Token只存本地忽略目录 |
| 清理与局限 | 临时1会话/1角色DELETE成功，读回均404；临时预览公共入口及持久脚本均404。实际`/api/models`容量仍null，不能宣称线上发现32K；未知容量保留全部有效历史与激活世界书，不阻断聊天。模型仍可能不遵守格式，不承诺候选永久必达、不追加第二次推理 |

架构最终复核通过。实现、固定Linux桌面/iPhone WebKit视觉、PR必需CI、自动部署及上述真实JWT/API/模型日志均独立验收；不把设备模拟宣称为真机验收。前面待验收叙述均为相应历史阶段。

## Agent 第一阶段：短提示词与受控预算（2026-10-04）

长期路线见[TAVERN-AGENT-PLAN.md](../AGENT.md)，首批仅实施第1步，后续DO/state/摘要/工具/世界书RAG尚未上线。当前主目录已切到最新main，酒馆入口为apps/tavern，不再依赖旧工作树定位。

精炼默认写作与同次候选协议，只迁移精确匹配两个已知旧默认的设置，保留用户自定义。模型输入软目标12288、用户声明的32K规划上限，发现更小容量优先；未知能力仍报告null，不使用Infinity发送全历史。保护当前输入和上一完整问答；旧历史按起点约2048估算tokens的完整轮次块裁剪，原文不删除，尚无长期记忆。

显式请求cache_prompt:true、保留Gateway skipCache:true；二者分别为上游KV复用和回复缓存，不将字段存在当缓存成功。日志增加实际prompt/output/cached tokens、prefill/decode时序及生成/模型调用阶段首正文耗时。另记录分项预算、发现值/规划值及未包含消息数。上游缺指标为null，不编命中率。

83项相关轻量测试、聚焦Worker TypeScript与diff-check通过。架构复核提出的容量来源标记、固定块边界/大轮次覆盖已修正；首次固定Linux截图11流程/68图通过，默认文案2图有意变化。恢复已安装Docker Desktop后使用同一固定镜像，未放宽容差。最终截图导入、PR/CI、自动发布与真实JWT/模型/cache验收仍待完成，后续以最终交付记录为准。

PR #36八项必需状态通过并squash为`cf1dfeb459570a23b0f4999bfa1efb4e649cba18`，自动Build `2d9cfb37-7ce7-4715-9cf7-eaed6c7af715`成功且SHA一致，version `f5ddd817-a7de-40b2-afc9-2cd10e32e7e2`线上health一致。首次真实JWT正文正常stop但0候选，临时2会话/1角色全部删除；因此未作为最终候选验收。后续修正恢复此前验证过的完整固定候选协议，仅保留写作规则精简、分块预算和观测。候选/缓存需在修正自动发布后复验。

PR #37八项必需状态通过并squash为`fe2b7df6ce4241ca3fc5322f52a776432244de5f`，自动Build`c3681dea-cdef-4b7b-91ee-495599670daa`成功且SHA一致，version`b3d70086-079b-4d60-a063-aeebf717234a`线上一致。恢复旧协议后的真实前两轮正文254/227字、3/3候选、持久化和原UUID回放通过；第三轮正文正常stop但候选0。原始日志`01M419GQ3G7YZ4NT30C4NK0DC4`实际输出3条有效短句，分隔符紧接正文，缺少前置换行，既有解析器没有进入尾部。该轮未通过正文隔离验收。

已按原始响应修复默认保留标记的流式容错：同时接受完整换行标记和缺前置换行的标记，仍要求后置换行；完整形式优先，跨chunk不提前泄露协议，自定义marker语义不变。新增所有切分位置、CRLF、标记中断、Worker delta/终态/持久化和单次模型调用测试，65相关测试通过；不再修改提示词、不补发候选推理、不改截图基线。此前3轮真实cache_n均0，保留失败样本，不宣称缓存命中；剩余有限样本在修正版发布后核验新临时会话和重新生成。

## Agent 第一阶段最终交付（2026-10-04）

[PR #38](https://github.com/hasbai/financial/pull/38)八项必需状态通过并squash为`d482ed5c0002d4bcad06966da988b709a1b0ad7d`。自动Build`32db16cc-6f69-49ef-ade3-967c483d3c01`成功，push_event/main与commit_hash一致；deployment`0341a2ae-efc7-4c7b-8f4c-9bd2f7a53e92`、version`9f53f4c9-2994-4f01-8778-19266bfd222a`流量100%。Node原生fetch health200且版本一致，未手动部署；Python urllib同URL一度403，未将它认定为Worker发布失败。当前主目录已回到最新main。

既定6轮样本保留前3轮及第3轮失败记录，不重置抽样。修复后剩余3轮使用新临时会话A/B/A重生成。原前3轮会话已清理，不能声称返回原已删除会话。

正文407/245/382字，全部completed/stop、3候选、无协议泄露。刷新读回、原UUID回放一致，锁释放。临时2会话/1角色清理3/3；早先两个探针各2会话/1角色也已全部清理。此次未新增真实续写验收，相关续写预算/解析由自动化覆盖。

| 样本 | Gateway日志 | 输入tokens | cached tokens | 实际新prefill tokens | prefill ms | 客户端首正文ms | 应用总验收ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4，新A正常 | `01M41AEP4R9TYXMAS0TF8YDH1X` | 426 | 0 | 426 | 700.516 | 3579 | 15194 |
| 5，切至新B | `01M41AF554FNYAB2P91D4B0FB7` | 426 | 422 | 4 | 258.423 | 3338 | 11256 |
| 6，返回新A重生成 | `01M41AFFS161H0MBC7N1Y9WG5Q` | 426 | 422 | 4 | 246.464 | 2461 | 12830 |

三条日志event_id逐轮匹配真实请求，HTTP200、custom-pc/qwen3.8-27b、3条messages、cache_prompt:true、Gateway cached:false和三项metadata正确；完整聚合正文经同一解析器处理后的SHA256与应用正文一致，streamed_data分别345/220/341。原UUID回放无额外模型请求。缓存token同时由usage.prompt_tokens_details.cached_tokens及timings.cache_n证实；应用总验收时间包含持久化读取/回放，不能冒充纯模型耗时。

同卡、相同输入、同开场的后两条请求具有相同模型可见前缀，因此证实当前部署支持实际KV复用；不是仅字段存在。此前连续增长3轮输入426/626/805、cached均0。最后两条重复前缀样本不能证明长聊稳定命中，也不承诺统一百分比提速。

只读本地/props当前HTTP200：实际n_ctx32768、total_slots1、model_alias qwen38-27b、build b11200-81bc6b83f；chat_template_caps报告supports_tools/tool_calls/object_arguments/parallel_tool_calls/preserve_reasoning等为true。该元数据不等于真实工具执行与验收，未修改本地推理配置。下一优先项是增长历史缓存/实际slot行为，再接会话DO、state与摘要、有限工具循环。首批仅短写作规则、受控分块预算、缓存请求/观测和候选协议隔离；DO/长期记忆/工具/RAG尚未上线。

## 自动压缩与无硬限续写（2026-10-04）

按最新用户批注修订第一阶段：移除固定32768规划上限、12288输入目标和整块历史丢弃；容量未知时保留全部有效历史，超过已发现容量或明确上游context错误时才摘要较早完整轮次。摘要绑定消息ID/内容指纹，原消息不删除；分支不复制旧摘要，重生成只复用有效来源。摘要自身超限或length按时间顺序拆小输入继续压缩。

移除maxTokens设置/上游max_tokens、整轮175秒deadline和100000字符截断；length在同一请求ID/assistant消息/SSE/候选解析器内自动续写，不设模型请求次数上限。特别长的当前输出仅压缩模型投影中的较早片段，完整正文持续保留。用户停止、断连、无进展和上游故障仍保存部分正文。180秒占用持续续租；所有写入检查当前生成ID，checkpoint写入还检查pending状态，避免长生成被接管或停止后迟到写入。

本地相关98项单元/Worker检查通过，包含64K/未知容量、摘要源失效、摘要自身超限及超过三次length续写。另检查跨请求候选标记、stream context错误、大段新输出和取消摘要。覆盖占用接管、终态心跳竞态及超过旧正文字符上限。

定向TypeScript检查及diff检查通过。完整CI、固定Linux视觉、真实JWT与生产发布证据随交付补充。DO/state/search_memory/update_state尚待下一阶段；本批不同时迁移会话存储。

### 本批发布与验收证据

- [PR #40](https://github.com/hasbai/financial/pull/40)：同步最新main后的提交`a2954256ee277303082d6e3fd6456a25758add2f`八项必需状态全部成功；Check `37140960323`、Blog `37140960334`、Tavern `37140960328`、Zboard `37140960329`各仅一次统一等待。Squash main为`5604464e2b4da495df7cb163283b4dec0930378a`。
- 固定Linux11流程/68截图通过，审阅/import六张有意变化的设置截图；其余两个24/1像素噪声保留原基线。iPhone WebKit为设备模拟，不算真机验收。交互架构图64K/超限/未知案例检查通过。
- 远程隔离D1 `68cce847-d93a-421e-b113-48c5e34e2126`先应用旧schema、插入固定ID/原文，再应用0006并验证摘要可写、原ID与原文不变；临时库已删除。生产迁移前后均2会话/21消息，新增nullable TEXT summary_json且旧摘要为NULL。原Worker兼容；先迁移再发布。
- 自动Build `2bd0f253-ed42-4745-8be7-a6118dd04a1e`成功，commit_hash与main一致；deployment `d0e97a3e-16a8-4da7-9769-024149fc84a2`、version `7931cada-ae49-45af-a274-f81025631fc8`流量100%，版本反查Build一致，线上health200版本一致。无手动部署。
- 真实JWT复验尚未进入模型阶段：正常Universal Login + PKCE取得令牌后，`GET /api/settings`返回403“无权访问酒馆”；未创建验收角色或会话。只读Auth0检查确认验收账号及组织仍有superadmin，共享Action已改为roles/email/username，现有应用仍读取role与命名空间用户名。用户明确选择保留新字段、另行统一迁移应用鉴权；本批未改Auth0、未放宽权限。新的真实摘要/连续length/cache验收待该迁移后补做，不将98项模拟检查或此前缓存样本冒称本批真实模型通过。
- `/Users/yueshi/src/financial`已回到main并同步远端，稳定代码入口仍为`apps/tavern`。DO/state/工具与世界书RAG按长期方案后续实施。

## 按优先级推进：每会话 DO（2026-10-04）

基于最新main推进；路线改为动态优先级，不固定七步。本批只做SQLite会话DO及真实验收发现的摘要兼容修复，state与工具执行随后实现。

- 每个签名owner+session对应独立DO；会话快照、设置、完整消息版本、摘要、UUID与生成占用由SQLite统一管理，全部会话接口经同一入口。D1保留目录、角色、世界书与用户设置。
- 旧会话在空闲/到期时先写D1永久generation哨兵冻结旧Worker，再事务导入所有消息/候选/终态/摘要并逐字段核对；失败可重试且保留来源。旧活跃生成仍可通过原pending状态停止，未解除旧占用前不迁移。删除保留tombstone，不能从旧D1重新出现。
- 停止立即取消当前模型；Worker断流显式传递取消，准备阶段取消也持久记录并在claim前检查。没有增加硬轮数、输出预算或整轮运行时限。
- DO记录目录revision与已同步revision，alarm重试D1同步；目录慢不阻塞done或下轮推理。世界书绑定先保留旧+新引用并集，DO提交后才收窄；失败和重启不丢引用保护。
- 真实JWT访问已恢复。35188字符样本正常完成但未超限，不能当摘要验收。100152字符样本上游报70234tokens超过32768；旧摘要assistant-last导致角色续写，回送25040字符源文本、仅2个新输出tokens，未形成有效checkpoint。摘要已改成system规则+user来源数据，角色标记保留；修复后的真实复验见下方。
- 109项Node核心/Worker测试与Svelte诊断0错误/0警告；真实workerd SQLite隔离harness验证导入/fence、跨用户/会话隔离及流式候选。另验证回放、分支、停止、跨实例数据恢复、未完成回合恢复和删除不复活。runtime模型为夹具，不能算生产推理通过。已加入Tavern CI。
- 固定Linux28流程/84截图通过，4张原始像素差1/24/27/62均无UI修改，未替换基线；62像素的中断场景另以原50容差严格比较通过。桌面/iPhone WebKit为设备模拟。
- 远程隔离D1 `a2798176-f09d-430b-a47b-33c46e02951d`验证0007、原ID/摘要/候选/正文与旧写入fence，已删除。生产迁移前后均2会话/26消息，均仍legacy，只新增storage_backend/deleted_at；实际访问后才惰性迁移。

### 本批发布及真实验收

- [PR #43](https://github.com/hasbai/financial/pull/43)八项必需状态全成功；Check37148381900、Blog37148381887、Zboard37148382012、Tavern37148381907各只等一次。Squash main `8ec1f71cdcc5fd9a5b64404ba0557bfb364cb512`。
- 自动Build `81358ed7-891d-4871-ae58-f9b3c95b4e19` success、push_event/main及commit_hash精确匹配；version `a1bf6820-c87e-4134-9f18-32018f8c6660`流量100%，health200同版本，线上migration_tag=session-v1、SESSIONS binding存在。没有手动重复部署。
- 正常Universal Login + PKCE/JWT下，两条既有会话（5/21个版本）已惰性迁移。原ID/正文/状态/序号/时间/finish_reason及选中版本逐项保持；D1来源仍26版本，storage_backend=do且generation_id=do:<对应ID>，没有重写旧正文。
- 另一旧Worker创建的临时会话在发布后导入，问候ID/角色快照不变。正常/重生成各80/15字、stop/3候选，UUID回放、刷新读回、编辑分支、导出全部4消息版本、即时停止及删除后404通过。测试两会话/一角色3/3逻辑删除与R2原文件清理；D1迁移来源和DO删除标记按设计保留。
- 100152字符开场真实压缩：四次summary请求均为system+user/HTTP200，实际输入17531/17651/17651/17648 tokens、输出121/117/117/115 tokens；没有max_tokens。生成前形成152字摘要，抽查船未出港、钥匙仍在掌柜手中、岚未答应离开三项否定事实正确；没有声称完整语义保真。不是截断源文本。
- 该长聊两轮真实正文76/80字，completed/stop/3候选，无error/协议泄露，原开场SHA256不变、回复刷新与UUID回放一致。Gateway聚合正文SHA256与应用保存逐字一致。第一轮4次摘要+1次roleplay，第二轮只1次roleplay；第二轮system全文SHA256相同，证实从DO复用持久checkpoint，不重复摘要。临时2会话/1角色3/3逻辑清理，原26版本未删。

| 长聊轮次 | 模型实际输入tokens | cached tokens | roleplay prefill ms | 客户端首正文ms | 摘要请求 |
| --- | --- | --- | --- | --- | --- |
| 1，超限压缩后 | 462 | 0 | 791.586 | 82313 | 4 |
| 2，复用checkpoint | 547 | 0 | 1089.417 | 2138 | 0 |

第一轮总验收85430ms包含四段摘要的预填与生成，不能说慢模型的摘要无额外成本；第二轮5560ms包含持久化/回放。两条增长历史cached仍0，DO不等于GPU缓存命中。独立临时短会话正常/重生成的输入均338 tokens，cached为0/334，新prefill为338/4，prefill为658.330/243.173ms；只有重复完整前缀证明KV复用，不能推广为所有长聊。

上述真实日志均经eventId关联，cache_prompt=true、完整payload、三项metadata={app:tavern,task:roleplay,username:时阅}，没有应用输出硬限。摘要152字与原始/用户正文仅保存在本地忽略验收目录；文档不复制私人角色内容。

原100K失败样本仍记录，未替换成成功统计。当前主目录在最新main；工作树证据已复制保留。下一优先state快照和search_memory/update_state工具执行，缓存增长历史稳定性同步优化，世界书RAG后置。

本批未新增真实连续length样本，其超过三次续写及长正文压缩仍为自动化覆盖；不把超限摘要恢复当作length链路实测。整个Agent目标仍未完成。

## 阅读位置与候选补齐修复（2026-10-04，已交付）

按用户要求先修订方案，再实施。同步main dcc7bc2；保留用户编辑的参考项目段。真实JWT读取两会话12条已完成模型回复，4条无候选；对应完整Gateway流均stop且无[TAVERN_NEXT]，模型确实漏写，不是本批猜测解析偏差。未改私人历史正文。

生成增量、候选展开、输入伸缩、完成刷新不再自动滚到底；用户控制阅读位置。切换会话保留一次初始化定位，同会话刷新保留scrollTop，原follow距底阈值已移除。桌面/iPhone WebKit检查流式期间阅读、键盘返回顶部、草稿伸缩、完成刷新及自行滚到底查看三条候选。

已有三条候选仍单次推理；不足三条先保存正文，再在同一UUID/消息/占用/停止信号中只补缺额。补齐关闭常规正文提醒、替换输出协议，候选流不写正文；length或context超限保留半行并继续，自动压缩而无硬轮数/输出额度/总时限。

有效候选没有增加或上游故障则结束补齐、保留正文completed；主动停止仍aborted。日志记录缺失类型与补齐结局。

88项直接相关单元/Worker检查通过，包含0/1/2缺额、已有三条不追加、四次有进展请求及去重无进展。另检查补齐失败/即时取消、HTTP与半行流式超限、压缩无进展释放及回放。

Svelte诊断0错误/0警告。固定Linux28流程84截图通过；三张iPhone阅读位置有意变化已审阅，两张桌面1/24像素噪声保留原基线。完整CI、自动发布与真实模型补齐结果见下方；不将内联候选成功替代补齐实测。


### 本批发布与真实补齐证据

- [PR #44](https://github.com/hasbai/financial/pull/44)八项必需状态成功。Check `37170794869`、Blog `37170794882`、Zboard `37170794878`、Tavern `37170794859`各一次统一等待；squash main `d631a62a8f78c6403ac6956f1b7d392cc005080a`。主目录同步main干净。
- Workers Builds自动Build `70dd74c1-0321-4942-bb96-87f340e596e0`成功、commit_hash精确匹配代码合并；deployment `ec446d95-5f9f-4b10-ae09-592c580e2bbf`发布version `e3d40887-a2d0-4186-abb4-56455def768e`流量100%，health同版本。没有手动重复部署。
- 正常Universal Login + PKCE/JWT验收普通/重生成/显式续写/故意省略候选压力样本。正文55/79/87/60字，均completed/stop/3候选。delta与保存正文一致，刷新和原UUID回放一致。普通/重生成/压力样本各1次模型请求；压力样本本身内联三条，不能算补齐。
- 停止样本保存16字正文、stopped及占用释放；随后真实显式续写的主模型日志 `01M42BSDPJ27XCRWKHMQT33GSB`正常stop但没有保留标记，内联0候选。应用同UUID增加1次candidate-only请求，日志 `01M42BSJ5CP2541F0H81NJ002M`生成三条；原请求的主模型新正文与应用正文后缀逐字一致，最终三候选逐字等于补齐响应。该回合总2次请求，输入465/340tokens、输出52/42tokens；完整API验收8573ms包含生成、保存读取和回放，不是单纯模型耗时。
- 其余主模型日志为普通 `01M42BS027QK5ZZDHB61NSYBH6`、重生成 `01M42BS61C0CP1TSYHK5Y0YSWZ`、压力 `01M42BSRE6PH7PQ9ST6VNPM6F6`；各保留完整payload、cache_prompt=true及三项metadata（app=tavern/task=roleplay/真实签名username）。没有输出硬限，不以Gateway cached=false推断GPU KV缓存。本批没有新增缓存性能结论。
- 临时2会话/1角色已3/3逻辑删除，全局用户设置逐字保持。旧私人历史未重写；来源和DO删除标记依既有设计保留，不声称物理擦除。原始消息和响应留在忽略验收目录，文档不复制私人文本。

两项用户反馈已完成，手机为WebKit设备模拟；停止/上游错误/无进展仍允许保留实际候选数量，不承诺在模型故障下永远三条。整个Agent/state/工具目标仍未完成。

## 固定两阶段候选与完整前缀（2026-10-04，已发布）

用户选择正文后紧接独立候选，继续使用完整上下文；短候选试验保留，不作为实施方案。先修订方案，再修改。主目录已同步main 29b5012，保留私人历史与全局设置。

正文system不再要求内联候选；正常stop先保存，随后候选复制最后一次正文实际messages并追加本次新输出和候选任务。原前缀、最新user任务、世界书激活保持逐字一致；length后不重复累计正文。完整上下文超过发现窗口或明确上游超限时才压缩重建，日志单独计数。

候选临时步骤不会进入剧情摘要。固定两阶段沿用UUID/SSE/占用/立即停止/回放；候选故障或无进展保留正文，主动取消仍保留已输出内容。无新增表、设置、调度或硬预算。阅读位置未改。日志拆分正文stop、候选首字/完成及各阶段最后请求指标，缺值null。

92项直接相关Worker/context/shared检查通过，涵盖固定两请求、原前缀恒等、新正文触发世界书时system冻结。正文反复length时只追加末次输出。另检查候选半行/超限回退、摘要不含未来行动、失败/停止/回放。

真实workerd SQLite隔离harness同时检查两阶段原前缀并验证存储/停止/重启；模型仍为夹具，不算线上推理。Svelte0错误/0警告；固定Linux28条流程、84张截图通过，82张与原基线逐像素相同，其余两张仅1/24像素噪声，未导入新基线。全部CI、自动发布及真实JWT证据如下。


- [PR #45](https://github.com/hasbai/financial/pull/45)八项必需检查成功，Check `37173507323`、Blog `37173507292`、Tavern `37173507258`、Zboard `37173507240`各只启动一次统一等待。包含当时最新main，squash为`bca685af905541119f628ba4dcc4f91396d6ae2a`，主目录已同步main。
- 自动Build `e835fa25-88f4-4633-b1a9-f3900b8951b8` success，commit_hash/main精确匹配；deployment `e072fe76-7680-4433-a0c2-67301ee1fab0`、version `8971e134-980c-4ba7-a6cd-5f219f05b9cd`流量100%，health200且版本一致。没有手动部署。
- 真实Universal Login + PKCE身份通过应用API。普通回复/重生成/停止后显式续写/长上下文四种场景，各恰好两次roleplay请求。均三条有效候选、completed/stop。Gateway完整请求逐字段确认candidate原messages前缀等于实际body请求，追加assistant等于末次body原始输出；正文与三候选字节独立、存储/刷新/同UUID回放一致、占用释放。三项metadata和cache_prompt正确，Gateway回复缓存均false。

| 真实应用场景 | 正文字数 | 正文stop后候选等待 | 候选输入tokens | KV缓存tokens | 新prefill tokens | prefill / decode |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 普通回复 | 684 | 4.418s | 722 | 164 | 558 | 1.024s / 2.593s |
| 重生成 | 635 | 3.079s | 676 | 164 | 512 | 0.955s / 1.325s |
| 显式续写 | 410（含原11字） | 2.805s | 561 | 486 | 75 | 0.567s / 1.639s |
| 约16K上下文 | 509 | 3.923s | 16026 | 15951 | 75 | 0.686s / 2.044s |

等待从客户端candidates_pending至done，包含网络/收尾，不是最后可见字符或纯decode。长样本正文冷输入15598tokens、prefill14.190s、首正文17.013s，正文stop26.383s；候选无需重复预填长历史。短两样本只复用原输入，新增正文参与prefill，不能承诺所有生成内容必然命中；这些四次样本也不代表P95。

- 正文流中11字时真实stop成功，stopped、字节保留、锁释放，再续写完成。候选阶段停止尝试一次HTTP409，未算成功验收；该路径以相关自动化/workerd覆盖为证，不宣称本轮真实候选停止已通过。创建长临时会话后立即PATCH设置也曾HTTP409、未进入推理；该次未保留错误正文，不推断具体同步原因，新临时会话重跑通过。
- 三批临时资源2/4/4个全部通过删除API逻辑清理，未宣称物理擦除；全局设置前后相同，未修改私人历史。4组完整日志与回放、验证结果保存在忽略目录`apps/tavern/.local-visual/full-candidate-prefix`，没有写出Token。关键日志普通候选`01M42ET9EAC9W9767A0K12B523`、重生成`01M42ETVTX6JHH9B67R6067RET`、续写`01M42EZJD44RZ9RFGFE5E4SS49`、长正文`01M42F3MMK1HJ9PXPB6QXCN541`/候选`01M42F4DFWB2XNYARXX7EMT992`。

本批固定两阶段与完整前缀已交付；state/工具实现与验收、世界书RAG仍按优先级后续推进。

# Tavern 模型参数与独立 Director

对话模型目录经 `AI_SERVICE` 读取[统一 AI Worker](../ai/README.md)（包含发现的 Provider 模型与已部署动态路由，默认 `dynamic/rp`；模型和路由由 AI Worker 校验并管理凭据）。实现入口：`apps/tavern/shared/settings.ts`、`worker/director.ts`、`worker/inference.ts`、`worker/gateway.ts`。证据与差异见 [PROGRESS](PROGRESS.md)。

## 角色卡生成

`worker/character-generation.ts` 使用平台默认对话模型、关闭思考与 `shared/character-draft.ts` 的 `response_format:json_schema`（`task=character-generation`），仅在可靠 `stop` 且通过 `parseCard` 后回填 CCv2 草稿（异常直接报错保留草稿，不补模板或重试）。

## 设置、默认值与模型边界

| 设置 | 默认值 | 校验与请求映射 |
| --- | --- | --- |
| `modelId` | `dynamic/rp` | 从目录选择（旧 `rp`/`translate` 转同名路由，旧 `default` 转 `dynamic/rp`）；已下架模型保留 ID 并标不可用，拒绝静默切回 |
| `thinkingEnabled` | **`false`（关闭）** | 默认传 `chat_template_kwargs.enable_thinking:false` 与 `reasoning_effort:none`（加 `reasoning_format:deepseek` 分离思考） |
| `reasoningEffort` | `low` | `low` / `medium` / `high`（关闭时传 `none` 并保留选档） |
| `temperature` / `topP` | `0.7` / `0.80` | 温度 0–2（步长 0.05）；Top P (0, 1]（步长 0.01，传 `top_p`） |
| `topK` | `20` | 0 省略字段（不覆盖上游）；非零 1–1000 整数传 `top_k` |
| `frequencyPenalty` / `presencePenalty` | `0` / `1.5` | 目标范围 −2–2，分别传 `frequency_penalty`、`presence_penalty` |
| `minP` / `repetitionPenalty` | `0.0` / `1.0` | Min P 0–1；重复惩罚 (0, 2] |

- **模式模板（`shared/types.ts`）**：Thinking（温度 1.0、`top_p` 0.95、`top_k` 20、`min_p` 0、`presence_penalty` 0、`repetition_penalty` 1.0）；Instruct（温度 0.7、`top_p` 0.80、`top_k` 20、`min_p` 0、`presence_penalty` 1.5、`repetition_penalty` 1.0；摘要与角色生成固定用 Instruct 且关闭思考）。切换思考开关或“恢复默认”应用对应模板并置 `frequencyPenalty=0`；旧设置缺思考字段一律补 `false`。
- **目录与容量**：`GET /api/models` 仅返回对话模型，选择器使用共享 `ModelPicker`（按 `provider` 与 `厂商/模型` 分组）。容量取自目录 `context_tokens`，仅在遇到更小上游限制时按实际模型 ID 缓存降低 1 小时（不再探测 `/props`）。
- **设置页 UI**：沿用 Luma neutral 与约 760px 宽度；顶部标题与主题开关，正文按“模型”“生成参数”“角色设定”分组（第一屏放模型、思考 Switch 与强度，桌面双列/手机单列，触控 ≥ 44px，不加说明横幅或推荐占位）；全局设置作新会话默认，当前会话使用独立快照（生成中禁改）。

## 续聊候选内容与 UI

- 正文正常完成且校验通过后，由独立 `DirectorAgent` 复用最后一次正文请求的实际上下文前缀（追加本次新正文与末尾 Director `user` 任务）生成最多 3 条**用户视角完整可发送文本**（每条建议 15–60 字、服务端硬上限 120 Unicode 字符，区分行动/台词方向，严格遵守最新暂停/禁止与已确认事实，不虚构事件或角色发言）。
- 仅在最新回复下方显示“接下来”与最多 3 张候选按钮（末尾输出期间先显短骨架，不抢焦点或强滚；无效则省略，不拿模板凑数）。点击直接以显式 `content/source` 入口发送并保留自由草稿；发送下一轮、重生成、切会话或编辑/删除历史立即清除旧候选。

## 运行结果与上下文显示

正文与 Director 的 prefill/reasoning/生成复用可展开进度模块（“处理中”“思考中”“生成中”；思考增量不混入正文或摘要，重连读持久记录）。工具与 Director 输出可展开，压缩仅显状态与失败原因；Director 失败保留正文并显错误。上下文显示估算 tokens、已发现容量与压缩覆盖数（非实际 usage/缓存命中）。

## 正文结束后的 Director Agent

- 沿用 `POST /api/sessions/:id/generate`（`candidates_pending → done`）。逐字段保留正文真实 `messages`、tools schema 与工具结果，追加新正文与末尾 `user` 任务（兼容仅允许开头 `system` 的模型模板）并设 `tool_choice: "none"`；仅整体超限时按 `ConversationContext` 重建并压缩已确认历史，更新 checkpoint 供后续正文复用。
- 使用正文所选模型与思考参数（开启思考时另传 `thinking_budget_tokens:0` 尽力限制推理，已知 Qwen 生效、Gemma 忽略）发送 `response_format` strict JSON Schema（`director_choices` 唯一字段 `choices` 恰 3 个非空互异字符串、≤ 120 Unicode 字符）。仅可靠 `stop` 且全部校验通过才原子保存（围栏/额外字段/`length` 均全丢弃，不重试不补缺，不影响已成功正文与状态；断开后后台继续，停止仍取消）。
- 普通回合为正文 + Director 两次请求，均保留 Gateway 完整日志、`eventId`、`skipCache:true` 与 `app`/`task`/`username` metadata；官方依据见 [AI Gateway 统一 API](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/) 与 [llama.cpp 服务契约](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)。

## 验收契约

| 阶段 | 必过条件 |
| --- | --- |
| 默认与白名单 | 默认思考 `false`；路由切换不阻断；缺参旧会话兼容；拒绝非白名单/旧 `continue:true` |
| 设置与会话快照 | 首屏思考关闭、模型可选、恢复默认、范围校验、新旧范围分离与持久保存 |
| DO 与 Director | 隔离 D1 迁移、跨 chunk JSON、3 条原子校验、UUID 幂等、长聊无逐轮梗概 |
| 候选交互 | 原文直发、草稿保留、切会话/重生成丢弃旧候选 |
| 视觉与真实模型 | 固定 Linux 截图审阅导入、CI 全绿、自动部署与真实模型验证（思考可开关、候选 schema 与前缀/tools 复用一致） |

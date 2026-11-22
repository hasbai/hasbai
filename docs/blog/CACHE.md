# 博客公开读取与缓存

当前实现以 Neon 为内容主库（管理员读写仍经 Auth0 JWT、GRANT 与 RLS）。私有 R2 桶 `hasbai-blog-public-cache` 保存完整公开内容快照供访客读取。内容模型见 [ARCHITECTURE](ARCHITECTURE.md)。

## 背景与存储选择

2026-10-20 排查发现 Blog Worker 当月约 27,509 次请求（24 小时采样边缘返回包含 `/.env`、`/.aws/config` 扫描 404/504）。当时公开内容只有 5 条（Markdown 合计 9,009 字节）。全量快照可以让陌生 slug 零 Neon 查询，且不膨胀缓存键。

| 服务 | 免费额度（账户共享，2026-10-20 核对） | 取舍 |
| --- | --- | --- |
| Workers | 100,000 请求/日。10 ms CPU/次 | 继续执行 SSR、公开查询与写入 |
| KV | 100,000 读/日。1,000 写/日。1 GB | 只存启用语言，不存正文避免低写额与撤回延迟 |
| D1 | 500 万读行/日。10 万写行/日。5 GB | 不另建同步投影 |
| R2 Standard | 10 GB-month。100 万 A 类、1,000 万 B 类/月。出网免费 | 存一份完整公开快照（保守估算占 B 类免费额约 0.83%） |
| Cache API | 按机房存放，无持久保证 | 不叠 HTML 或正文 TTL 层，避免跨机房撤回不一致 |

参考：[Workers](https://developers.cloudflare.com/workers/platform/pricing/)、[KV](https://developers.cloudflare.com/kv/platform/pricing/)、[D1](https://developers.cloudflare.com/d1/platform/pricing/)、[R2](https://developers.cloudflare.com/r2/pricing/)、[Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)。

## 读取

- SSR 请求级 `fetch`、浏览器导航 `/api/public` 与匿名 MCP 共用快照读取。管理员 MCP 仍直读源库，包含草稿。
- 只在重建快照时获取匿名 JWT，经 RLS 分页读取已发布且到期内容（不存草稿或未来正文）。未知路径直接返回空与 404，零源库请求。
- `/api/public` 返回 `Cache-Control: no-store` 与 `X-Blog-Source: r2`。生产缺少 R2 绑定返回不可用（无平台单测使用源替身）。搜索不得将用户输入拼入正则或 SQL。

## 更新、失效与排期

- 原文提交、译文保存、删除与标签修改后立即重建快照，不等待后续详情查询。重建时先按旧 ETag 条件写入随机 revision 失效标记，再分页重读匿名源数据并条件写入新快照（[R2 条件写](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)）。
- 数据库与 R2 不是跨服务事务。DB 成功而 R2 失败时，管理端明确提示重试。写入失效标记后旧正文停止公开，源库不可用则返回 503。
- 未来排期只在私有对象保存发布时间戳。首个到期请求触发重建并推进排期，不设分钟 cron。系统另有 24 小时过期兜底（不替代写后同步）。图床图片仍由 `images` R2 与 `immutable` 头负责。

## 验收

回归必须覆盖热快照命中、未知 slug 零 Neon 请求与源分页完整性。测试还必须覆盖草稿与未来正文隔离、语言回退、到期发布、撤回删除、失败标记与并发 ETag 冲突。线上核对 `X-Blog-Source: r2`、SSR、导航与匿名 MCP（交付流程见 [TESTING](../TESTING.md)）。

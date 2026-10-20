# Images · 图床

`apps/images` 统一管理博客和酒馆的图片、上传及 AI 生成。
Worker 为 `images`，域名为 `images.hasbai.xyz`。
前端复用共享 Auth0、Luma 和 Lucide。

## 存储与权限

- 全部图片保存在 R2 `image`，对象 key 为 `public.image.id`。
- 图片公开读取。酒馆只存头像和立绘的图片 ID，不再保存图片副本。
- 旧博客 UUID、`/images/:id` 地址和封面外键保留。博客通过服务绑定转发图片请求。
- 登录用户可上传、生成、查看和重命名本人图片。`images.all:all` 可管理全部图片。
- Worker 验证共享用户 JWT。数据库使用仅可访问图片表的 `images_service` 角色。
- 浏览器不获得数据库服务凭据，也不能直接标记上传完成。
- SHA-256 全局去重。相同字节复用原图片，不转移 owner；未完成对象可由相同字节补齐。
- 生成结果立即存入图床。取消角色编辑、保存失败或删除角色均不删除图床资产。
- 当前提供搜索、预览、上传、重命名和复制链接。永久删除不在本次范围内。

`database/images/0001_image_service.sql` 为兼容迁移。
服务端凭据通过 Worker Secret 配置，禁止进入前端。
旧酒馆头像的迁移与重新运行见 `apps/images/scripts/migrate-tavern-images.mjs`。
原始角色卡文件仍属于酒馆的原文件导出。

## AI 生成与 API

固定通过 AI Gateway `default` 的 `custom-codex/images/generations` 调用 Codex。
服务端只接受以下模型：

| 模型 ID | UI 名称 | 酒馆用途 |
| --- | --- | --- |
| `gpt-image-2.5-flare` | Flare · 普通 | 头像 |
| `gpt-image-2.5-sunburst` | Sunburst · 精细 | 立绘 |

图床 UI 可选择两种模型，API 的 `model` 使用完整 ID。
省略 `model` 时使用 Flare。未知模型返回 400，不回退其他模型。
Gateway 记录 `app=images`、用途 `task` 和已验证账户的 `username`。

| 接口 | 契约 |
| --- | --- |
| `GET /images/:id` | 公开图片，支持 HEAD、ETag、immutable 缓存 |
| `GET /api/me` | 当前用户的图床管理权限 |
| `GET /api/images?q=&page=1&scope=mine` | 每页 48 张；管理员可用 `scope=all` |
| `POST /api/images` | 图片字节；`X-Image-Name` 为 URI 编码名称；最大 10 MiB |
| `POST /api/generate` | JSON `{prompt,model,kind}`；`prompt` 最长 1800 字 |
| `PATCH /api/images/:id` | JSON `{name}`；本人或管理员重命名 |

`kind` 为 `image`、`avatar` 或 `portrait`，默认 `image`。
头像使用 1024×1024，立绘使用 1024×1536。
上传和生成返回 `{id,name,url,content_type,size,created_at,model}`。
酒馆接口固定用途与模型，客户端不能覆盖该映射。

## 开发与交付

根 `pnpm dev:images` 启动 5177，Worker API 使用 Wrangler 开发入口。
`pnpm --filter images build` 同时编译前端和 Worker。
检查、Linux 截图、PR 和自动部署统一见 [TESTING](../TESTING.md)。

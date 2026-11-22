# Images · 图床

`apps/images`（Worker `images`，域名 `images.hasbai.xyz`）统一管理博客与酒馆的图片存储、上传与 AI 生图。前端复用共享 Auth0、Luma 与 Lucide。

## 存储与权限

- 图片保存于 R2 `IMAGES`（桶 `image`，对象 key 为 `public.image.id`）。自定义域名 `media.hasbai.xyz` 提供公开直连。旧博客 UUID、`/images/:id` 路径与封面外键保留（博客通过服务绑定转发）。酒馆只保存图片 ID。
- 登录用户可以上传、生成、重命名与删除本人图片。`images.all:all` 可以管理全部图片。Worker 验签用户 JWT。数据库使用只访问图片表的 `images_service` 角色。迁移脚本 `database/images/0001_image_service.sql` 与 `0002_image_deletion.sql` 必须先于新 Worker 发布。
- 图片按 SHA-256 全局去重。相同字节复用原图，不转移 owner。未完成对象可以由同字节补齐，遇到待删除记录返回 409。生成结果立即入库。取消或删除角色不删除图床资产。
- 首页只显示缩略图。详情页 `/library/:id` 展示原图 URL、大图、下载与管理操作（只对本人或管理员显示）。删除前提示外链与引用影响（博客封面置空，正文与酒馆引用不自动清理）。删除先写 `deleted_at` 隐藏列表与公开读取，再清理 R2 与数据库行（失败可以原地重试）。R2 直连缓存必须手动清除或等待过期。
- 历史迁移脚本见 `apps/images/scripts/migrate-tavern-images.mjs`。

## AI 生成与 API

经 `AI_SERVICE` 调用 [统一 AI Worker](../ai/README.md)（上游 `default/custom-codex/images/generations`）。Gateway 记录 `app=images`、`task` 与 `username`。服务端只接受以下模型，未知模型返回 400：

| 模型 ID | UI 名称 | 用途与默认尺寸 |
| --- | --- | --- |
| `gpt-image-2.5-flare` | Flare · 普通 | 默认模型。头像（1024×1024） |
| `gpt-image-2.5-sunburst` | Sunburst · 精细 | 立绘（1024×1536） |

| 接口 | 契约 |
| --- | --- |
| `GET /images/:id` | 公开读取（支持 HEAD、ETag、`immutable` 缓存）。`?variant=thumb`（640×480 WebP q80）、`?variant=display`（1920×1920 WebP q85，由 `IMAGE_TRANSFORM` 转换，不放大且保留 GIF 动画）、`?download=1`（原字节附件下载） |
| `GET /api/me` | 当前用户的图床管理权限 |
| `GET /api/images?q=&page=1&scope=mine` | 每页 48 张。管理员可以使用 `scope=all` |
| `GET /api/images/:id` | 登录读取详情（含 `can_manage`、`deleting`） |
| `POST /api/images` | 图片字节上传，`X-Image-Name` 为 URI 编码名称，最大 10 MiB |
| `POST /api/generate` | JSON `{prompt,model,kind}`（`prompt` ≤ 1800 字，`kind` 为 `image`/`avatar`/`portrait`）。酒馆接口固定模型映射 |
| `PATCH /api/images/:id` | JSON `{name}`，本人或管理员重命名 |
| `DELETE /api/images/:id` | 本人或管理员永久删除（204，失败保留标记以供重试） |

## 开发与交付

根 `pnpm dev:images` 启动 5177。`pnpm --filter images build` 同时编译前端与 Worker。检查、截图、PR 与自动部署见 [TESTING](../TESTING.md)。

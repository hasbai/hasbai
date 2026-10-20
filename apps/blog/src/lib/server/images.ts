import { Hono } from 'hono';
import type { BlogBindings } from './http';
export const imageRoutes=new Hono<{Bindings:BlogBindings}>();
// Preserve published Markdown and editor URLs.
imageRoutes.all('/api/images',c=>c.env.platform!.env.IMAGE_SERVICE.fetch(c.req.raw));
imageRoutes.all('/images/:id',c=>c.env.platform!.env.IMAGE_SERVICE.fetch(c.req.raw));

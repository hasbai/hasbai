import type { ImageRow } from './database';

export const variants = {
  thumb: { width: 640, height: 480, fit: 'scale-down' as const },
  display: { width: 1920, height: 1920, fit: 'scale-down' as const },
};

export async function media(request: Request, env: Env, row: ImageRow): Promise<Response> {
  const url = new URL(request.url);
  const variant = url.searchParams.get('variant');
  const download = url.searchParams.has('download');
  const file = await env.IMAGES.get(row.id);
  if (!file) return Response.json({ message: '图片不存在' }, { status: 404 });
  const headers = new Headers({
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
  });
  let response: Response;
  if (variant && !download) {
    if (variant !== 'thumb' && variant !== 'display') return Response.json({ message: '图片尺寸无效' }, { status: 400 });
    // The caller checks the database before cache lookup so deleted assets stay unavailable.
    const key = new Request(`${url.origin}/images/${row.id}?variant=${variant}&etag=${encodeURIComponent(file.httpEtag)}`);
    const etag = `"${variant}-v1-${row.sha256}"`;
    if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ...Object.fromEntries(headers), ETag: etag, 'Cache-Control': 'public,max-age=0,must-revalidate' } });
    const cache = await caches.open('image-transforms-v1');
    const cached = await cache.match(key);
    if (cached) response = new Response(cached.body, cached);
    else {
      response = (await env.IMAGE_TRANSFORM.input(file.body)
        .transform(variants[variant])
        .output({ format: 'image/webp', quality: variant === 'thumb' ? 80 : 85, anim: true })).response();
      response.headers.set('Cache-Control', 'public,max-age=86400');
      await cache.put(key, response.clone());
    }
    // Revalidate with the Worker; the internal transform cache is separate.
    response.headers.set('Cache-Control', 'public,max-age=0,must-revalidate');
    response.headers.set('ETag', etag);
  } else {
    headers.set('Content-Type', row.content_type);
    headers.set('ETag', file.httpEtag);
    headers.set('Cache-Control', download ? 'no-store' : 'public,max-age=31536000,immutable');
    if (download) {
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[row.content_type];
      const name = row.name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\.(png|jpe?g|webp|gif)$/i, '') || row.id;
      headers.set('Content-Disposition', `attachment; filename="${row.id}.${extension}"; filename*=UTF-8''${encodeURIComponent(`${name}.${extension}`).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))}`);
    }
    const unchanged = !download && request.headers.get('If-None-Match') === file.httpEtag;
    response = new Response(unchanged ? null : file.body, { status: unchanged ? 304 : 200, headers });
  }
  for (const [name, value] of headers) response.headers.set(name, value);
  return request.method === 'HEAD' ? new Response(null, response) : response;
}

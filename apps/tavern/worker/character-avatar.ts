import { avatarImage, MAX_AVATAR_BYTES, type AvatarImage } from '../shared/avatar';
import { MAX_JSON_BYTES, object } from '../shared/cards';
import { body, boundedBody, HttpError } from './http';
import { roleplayGatewayOptions } from './gateway';

export async function characterForm(request: Request): Promise<{ card: Record<string, unknown>; avatar?: AvatarImage }> {
 const bytes = await boundedBody(request, MAX_JSON_BYTES + MAX_AVATAR_BYTES + 64 * 1024);
 try {
  const form = await new Response(Uint8Array.from(bytes), { headers: { 'Content-Type': request.headers.get('Content-Type') ?? '' } }).formData();
  const card = form.get('card'), file = form.get('avatar');
  if (typeof card !== 'string' || new TextEncoder().encode(card).length > MAX_JSON_BYTES || (file !== null && !(file instanceof File))) throw Error('角色表单无效');
  return { card: object(JSON.parse(card)), ...(file instanceof File ? { avatar: avatarImage(new Uint8Array(await file.arrayBuffer())) } : {}) };
 } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : '角色表单无效'); }
}

export async function generateAvatar(request: Request, env: Env, username: string): Promise<Response> {
 const data = await body(request);
 if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 1800) throw new HttpError(400, '请填写不超过 1800 字的头像描述');
 const options = roleplayGatewayOptions(env, username, crypto.randomUUID());
 options.gateway!.metadata = { app: 'tavern', task: 'character-avatar', username };
 try {
  const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
   prompt: `Character avatar, centered portrait, one character, no text.\n${data.prompt}`, steps: 4,
  }, { ...options, signal: request.signal });
  request.signal.throwIfAborted();
  if (!result.image || result.image.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4) throw Error('Invalid image');
  const image = avatarImage(Uint8Array.from(atob(result.image), char => char.charCodeAt(0)));
  return new Response(Uint8Array.from(image.bytes), { headers: { 'Content-Type': image.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
 } catch {
  throw new HttpError(request.signal.aborted ? 499 : 502, request.signal.aborted ? '生成已取消' : '头像生成失败，请重试');
 }
}

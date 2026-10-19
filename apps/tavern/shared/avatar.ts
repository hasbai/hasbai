import { isPng } from './cards';
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export type AvatarImage = { bytes: Uint8Array; type: string };
export function avatarImage(bytes: Uint8Array): AvatarImage {
 if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) throw Error('头像不能为空或超过 5 MB');
 const head = new TextDecoder('ascii').decode(bytes.slice(0, 12));
 const type = isPng(bytes) ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : head.startsWith('RIFF') && head.slice(8) === 'WEBP' ? 'image/webp' : '';
 if (!type) throw Error('头像仅支持 PNG、JPEG 或 WebP');
 return { bytes, type };
}

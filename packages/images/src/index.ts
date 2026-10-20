export const maxImageBytes = 10 * 1024 * 1024;
export function imageType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  const text = new TextDecoder("ascii").decode(bytes.slice(0, 12));
  if (text.startsWith("GIF87a") || text.startsWith("GIF89a"))
    return "image/gif";
  if (text.startsWith("RIFF") && text.slice(8) === "WEBP") return "image/webp";
  return null;
}
export async function boundedImage(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("图片不能为空");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxImageBytes) {
        await reader.cancel();
        throw new Error("图片不能超过 10 MB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!length) throw new Error("图片不能为空");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export type ImageAsset = { id: string; name: string; content_type: string; size: number; created_at: string; model?: string|null; url: string };
export const imageOrigin = "https://images.hasbai.xyz";
export const imageUrl = (id: string) => `${imageOrigin}/images/${encodeURIComponent(id)}`;

export const imageModels = [
 { id: 'gpt-image-2.5-flare', label: 'Flare · 普通' },
 { id: 'gpt-image-2.5-sunburst', label: 'Sunburst · 精细' },
] as const;
export type ImageModel = typeof imageModels[number]['id'];

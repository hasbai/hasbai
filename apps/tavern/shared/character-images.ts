// R2 custom domain: Cloudflare's native image transformations serve these bytes,
// without a Tavern/Images Worker request or a browser authentication round trip.
export const characterMediaOrigin = 'https://media.hasbai.xyz';
export function characterImageUrl(id: string, kind: 'avatar' | 'portrait') {
 const options = kind === 'avatar'
  ? 'width=160,height=160,fit=cover,quality=80,format=webp'
  : 'width=1024,height=1536,fit=scale-down,quality=85,format=webp';
 return `${characterMediaOrigin}/cdn-cgi/image/${options}/${encodeURIComponent(id)}`;
}

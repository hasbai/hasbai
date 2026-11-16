import { vi } from 'vitest';
import { resetDiscovery } from './discovery';

/** Stubs Cloudflare provider listing, provider /models and (optionally) the inference call. */
export function stubUpstream(infer: (url: string, init: RequestInit) => Response | Promise<Response> = () => new Response('{}'), providers: Record<string, unknown> = {main: {data: [{id: 'qwen3', context_length: 32768}, {id: 'text-embed-1'}, {id: 'chat-b'}]}}) {
  resetDiscovery();
  const call = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.includes('api.cloudflare.com') && url.includes('/custom-providers')) return Response.json({success: true, result: Object.keys(providers).map(slug => ({id: slug, slug, enable: true, base_url: 'https://example.com'}))});
    if(url.includes('/routes'))return Response.json({success:true,data:{routes:[{id:'rp',name:'rp',deployment:{version_id:'v1'}},{id:'translate',name:'translate',deployment:{version_id:'v1'}}]}});
    const match = url.match(/\/(custom-[a-z0-9_-]+)\/models$/);
    if (match) { const body = providers[match[1].slice(7)]; return body instanceof Response ? body : Response.json(body); }
    return infer(url, init);
  });
  vi.stubGlobal('fetch', call);
  return call;
}
export const inferCalls = (call: ReturnType<typeof stubUpstream>) => call.mock.calls.filter(([url]) => String(url).includes('/compat/'));

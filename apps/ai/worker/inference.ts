import type { AITask } from '@hasbai/ai';
import { HttpError } from './http';
import { chatModel } from './models';

export type Attribution = {app: 'tavern' | 'blog' | 'images' | 'ai'; username: string; requestId: string};
const tasks: Record<Attribution['app'], readonly string[]> = {
  tavern: ['roleplay', 'character-generation', 'embedding'], blog: ['translate'],
  images: ['image-generation', 'character-avatar', 'character-portrait'],
  ai: ['roleplay', 'translate', 'embedding', 'image-generation'],
};
export function validateTask(task: string, app: Attribution['app']): asserts task is AITask {
  if (!tasks[app]?.includes(task)) throw new HttpError(400, '未知 AI 用途');
}
export async function inference(env: Env, task: AITask, input: Record<string, unknown>, who: Attribution, signal: AbortSignal) {
  validateTask(task, who.app);
  const metadata = {...who, task};
  const {requestId, ...logMetadata} = metadata;
  const gateway = env.AIG_GATEWAY_ID;
  if (task === 'embedding') {
    if (!Array.isArray(input.text) || !input.text.length || !input.text.every(t => typeof t === 'string')) throw new HttpError(400, '向量输入必须是文本数组');
    const result = await env.AI.run('@cf/baai/bge-m3', {text: input.text as string[]}, {
      gateway: {id: gateway, skipCache: true, collectLog: true, eventId: requestId, retries: {maxAttempts: 1}, metadata: logMetadata},
      extraHeaders: {'cf-aig-collect-log-payload': 'true', 'cf-aig-event-id': requestId, 'cf-aig-max-attempts': '1'}, signal,
    });
    return Response.json(result, {headers: {'Cache-Control': 'no-store'}});
  }
  if (!env.AIG_RUN_TOKEN) throw new HttpError(503, 'AI 服务未配置');
  let path = 'compat/chat/completions', model: string;
  if (task.startsWith('image-') || task.startsWith('character-avatar') || task.startsWith('character-portrait')) {
    if (!['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].includes(String(input.model))) throw new HttpError(400, '未知图片模型');
    model = String(input.model); path = 'custom-codex/images/generations';
  } else model = await chatModel(env, input.model, task === 'translate' ? 'translate' : 'roleplay');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', 'cf-aig-authorization': `Bearer ${env.AIG_RUN_TOKEN}`,
    'cf-aig-skip-cache': 'true', 'cf-aig-collect-log': 'true', 'cf-aig-collect-log-payload': 'true',
    'cf-aig-event-id': requestId, 'cf-aig-max-attempts': '1',
    'cf-aig-metadata': JSON.stringify(logMetadata).replace(/[^\x00-\x7f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')),
  };
  if (path.startsWith('custom-') || model.startsWith('custom-')) headers['cf-aig-byok-alias'] = 'default';
  const abort = new AbortController();
  const response = await fetch(`https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${gateway}/${path}`, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.any([signal, abort.signal]), headers, body: JSON.stringify({...input, model}),
  });
  // Preserve streaming, upstream status and the headers used by inference metrics.
  const outgoing = new Headers();
  for (const name of ['content-type', 'cf-aig-log-id', 'cf-aig-event-id', 'retry-after']) {
    const value = response.headers.get(name); if (value) outgoing.set(name, value);
  }
  outgoing.set('Cache-Control', 'no-store');
  const reader = response.body?.getReader();
  const stream = reader ? new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {const next = await reader.read(); if (next.done) controller.close(); else controller.enqueue(next.value);}
      catch (error) {abort.abort(); controller.error(error);}
    },
    async cancel(reason) {abort.abort(reason); await reader.cancel(reason);},
  }) : null;
  return new Response(stream, {status: response.status, headers: outgoing});
}

export const AI_ORIGIN = 'https://ai.hasbai.xyz';
/** Upstream chat model IDs are interpolated into requests and settings, so both ends share one shape. */
export const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._/:+-]{0,255}$/;
export type AITask = 'roleplay' | 'character-generation' | 'translate' | 'embedding' | 'image-generation' | 'character-avatar' | 'character-portrait';
export type AIAttribution = { app: 'tavern' | 'blog' | 'images'; username: string; requestId?: string };
export type AIService = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };

/** Only server code with the named service binding can supply trusted attribution. */
export function runAI(service: AIService | undefined, task: AITask, input: Record<string, unknown>, attribution: AIAttribution, signal?: AbortSignal) {
  if (!service) throw Error('AI 服务未配置');
  const metadata = JSON.stringify(attribution).replace(/[^\x00-\x7f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const pending = service.fetch(`${AI_ORIGIN}/internal/${task}`, {
    method: 'POST', redirect: 'manual', signal,
    headers: { 'Content-Type': 'application/json', 'X-AI-Attribution': metadata },
    body: JSON.stringify(input),
  });
  if (!signal) return pending;
  return pending.then(response => {
    if (!response.body) return response;
    const reader = response.body.getReader(); let ended = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const detach = () => signal.removeEventListener('abort', stop);
    const stop = () => {
      if (ended) return; ended = true; detach();
      controller.error(signal.reason);
      void reader.cancel(signal.reason).catch(() => {});
    };
    const body = new ReadableStream<Uint8Array>({
      start(value) {controller = value; signal.addEventListener('abort', stop, {once: true}); if (signal.aborted) stop();},
      async pull(value) {
        try {const next = await reader.read(); if (ended) return; if (next.done) {ended = true; detach(); value.close();} else value.enqueue(next.value);}
        catch (error) {if (!ended) {ended = true; detach(); value.error(error);}}
      },
      async cancel(reason) {if (ended) return; ended = true; detach(); await reader.cancel(reason);},
    }, {highWaterMark: 0});
    return new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
  });
}

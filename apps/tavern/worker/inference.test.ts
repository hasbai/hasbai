import { afterEach, expect, it, vi } from 'vitest';
import { AGENT_TOOLS } from './agent';
import { ROLEPLAY_GATEWAY_URL } from './gateway';
import { inferRoleplay, InferenceError, type InferenceEvent } from './inference';
import { modelInput } from './models';
import { DEFAULT_SETTINGS } from '../shared/types';

const env = { AIG_RP_RUN_TOKEN: 'fixture-only' } as Env;
const messages = [{ role: 'system' as const, content: '设定' }, { role: 'user' as const, content: '你好' }];
const signal = () => new AbortController().signal;
const response = (events: unknown[]) => new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream', 'cf-aig-log-id': 'sdk-log' } });
const chunk = (delta: unknown, finish_reason?: string) => ({ choices: [{ delta, finish_reason }] });
async function collect(stream: AsyncIterable<InferenceEvent>) { const events = []; for await (const event of stream) events.push(event); return events; }
afterEach(() => vi.unstubAllGlobals());

it('uses the SDK provider with the complete fixed-route wire and retains raw observations', async () => {
 const observation = { ...chunk({ content: '你好。' }, 'stop'), model: 'backend', usage: { prompt_tokens: 12, completion_tokens: 3 }, timings: { cache_n: 4, prompt_ms: 5 } };
 const fetch = vi.fn().mockResolvedValue(response([observation])); vi.stubGlobal('fetch', fetch);
 const input = { messages, tools: AGENT_TOOLS, tool_choice: 'auto' as const, ...modelInput(DEFAULT_SETTINGS) };
 const events = await collect(inferRoleplay(env, '用户😀', 'request-id', input, signal()));
 expect(events).toContainEqual({ type: 'text', text: '你好。' });
 expect(events).toContainEqual({ type: 'observation', value: observation, logId: 'sdk-log' });
 expect(events.at(-1)).toEqual({ type: 'finish', reason: 'stop', calls: [] });
 expect(fetch).toHaveBeenCalledOnce();
 const [url, options] = fetch.mock.calls[0]; expect(url).toBe(ROLEPLAY_GATEWAY_URL);
 expect(JSON.parse(options.body)).toEqual({ ...input, model: 'dynamic/rp', stream: true });
 expect(JSON.parse(new Headers(options.headers).get('cf-aig-metadata')!)).toEqual({ app: 'tavern', task: 'roleplay', username: '用户😀' });
 expect(new Headers(options.headers).get('cf-aig-event-id')).toBe('request-id');
 expect(options.redirect).toBe('manual');
});

it('lets the SDK parse complete calls while retaining original strings, nullable patches and call order', async () => {
 const args = '{ "patch": { "facts": { "钥匙": null } } }';
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
  chunk({ content: '她放下钥匙。', tool_calls: null }),
  chunk({ tool_calls: [{ index: 2, id: 'state', type: 'function', function: { name: 'update_', arguments: args.slice(0, 20) } }] }),
  chunk({ tool_calls: [{ index: 2, id: null, type: null, function: null }] }),
  chunk({ tool_calls: [{ index: 2, function: { name: 'state', arguments: args.slice(20) } }, { index: 0, id: 'recall', function: { name: 'search_memory', arguments: '{"query":"钥匙"}' } }] }, 'tool_calls'),
 ])));
 const events = await collect(inferRoleplay(env, 'u', 'r', { messages, tools: AGENT_TOOLS }, signal()));
 expect(events.filter(e => e.type === 'text')).toEqual([{ type: 'text', text: '她放下钥匙。' }]);
 expect(events.at(-1)).toEqual({ type: 'finish', reason: 'tool_calls', calls: [
  { id: 'state', type: 'function', function: { name: 'update_state', arguments: args } },
  { id: 'recall', type: 'function', function: { name: 'search_memory', arguments: '{"query":"钥匙"}' } },
 ] });
});

it.each([400, 429, 500, 503])('retains HTTP %i context feedback and log ID without an SDK retry', async status => {
 const fetch = vi.fn().mockResolvedValue(Response.json({ error: { n_ctx: 4096 } }, { status, headers: { 'cf-aig-log-id': 'failure-log' } })); vi.stubGlobal('fetch', fetch);
 await expect(collect(inferRoleplay(env, 'u', 'r', { messages }, signal()))).rejects.toMatchObject({ value: { error: { n_ctx: 4096 } }, reason: status === 429 ? 'rate_limited' : 'upstream', logId: 'failure-log' });
 expect(fetch).toHaveBeenCalledOnce();
});

it.each([
 [chunk({ content: '原稿。' })],
 [chunk({ content: '原稿。' }, 'stop'), chunk({}, 'length')],
 [chunk({ tool_calls: [{ index: 0, id: 'broken', function: { name: 'search_memory', arguments: '{' } }] }, 'tool_calls')],
 [chunk({ content: '原稿。' }), { error: { message: 'provider failed' } }],
].map(events => ({events})))('rejects unreliable completion and malformed tools without a second request', async ({events}) => {
 const fetch = vi.fn().mockResolvedValue(response(events)); vi.stubGlobal('fetch', fetch);
 await expect(collect(inferRoleplay(env, 'u', 'r', { messages, tools: AGENT_TOOLS }, signal()))).rejects.toBeInstanceOf(InferenceError);
 expect(fetch).toHaveBeenCalledOnce();
});

it('delivers prose before the provider finishes and cancels a blocked upstream reader', async () => {
 const abort = new AbortController(), cancel = vi.fn(); let controller!: ReadableStreamDefaultController<Uint8Array>;
 const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) { controller = c; }, cancel }), { headers: { 'Content-Type': 'text/event-stream' } })); vi.stubGlobal('fetch', fetch);
 const stream = inferRoleplay(env, 'u', 'r', { messages }, abort.signal), pending = stream.next();
 await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
 controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(chunk({ content: '先显示正文。' })) + '\n\n'));
 let event = await pending;
 while (event.value?.type !== 'text') event = await stream.next();
 expect(event.value).toEqual({ type: 'text', text: '先显示正文。' });
 const waiting = stream.next(); abort.abort();
 await expect(waiting).rejects.toMatchObject({reason:'interrupted'});
 expect(cancel).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
});

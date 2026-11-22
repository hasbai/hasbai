import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { jsonSchema, streamText, tool, type ModelMessage } from 'ai';
import { isToolCapableFinish, mapUpstreamFinishReason } from '../shared/outcomes';
import type { PromptMessage } from '../shared/prompt';
import { sseData } from '../shared/sse';
import { AGENT_TOOLS, stableJson, ToolCallStream, type ToolCall } from './agent';
import { ROLEPLAY_GATEWAY_URL, runRoleplay } from './gateway';
import type { InferenceMetrics } from './metrics';

type Observation = Parameters<InferenceMetrics['observe']>[0] & { model?: string };
export type InferenceEvent =
 | { type: 'text'; text: string }
 | { type: 'reasoning'; text: string }
 | { type: 'observation'; value: Observation; logId: string | null }
 | { type: 'finish'; reason: string; calls: ToolCall[] };
export type InferenceFailureReason = 'upstream' | 'rate_limited' | 'interrupted' | 'unsupported' | 'content_filter' | 'invalid_output' | 'length';
export class InferenceError extends Error {
 logId: string | null = null;
 hasToolFragments = false;
 constructor(readonly value: unknown, readonly reason: InferenceFailureReason = 'upstream', readonly detail?: string) { super('模型推理失败'); }
}
type Input = { messages: PromptMessage[]; tools?: typeof AGENT_TOOLS; tool_choice?: 'auto' | 'none'; [key: string]: unknown };

function modelMessages(messages: PromptMessage[]): ModelMessage[] {
 const names = new Map(messages.flatMap(m => (m.tool_calls ?? []).map(c => [c.id, c.function.name] as const)));
 return messages.map(m => {
  if (m.role === 'tool') return { role: 'tool', content: [{ type: 'tool-result', toolCallId: m.tool_call_id!, toolName: names.get(m.tool_call_id!)!, output: { type: 'text', value: m.content } }] };
  if (m.role === 'assistant' && m.tool_calls?.length) return { role: 'assistant', content: [
   ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
   ...m.tool_calls.map(c => ({ type: 'tool-call' as const, toolCallId: c.id, toolName: c.function.name, input: JSON.parse(c.function.arguments) })),
  ] };
  return { role: m.role, content: m.content };
 });
}

/** One model step. Domain code validates the complete tool batch before executing it. */
export async function* inferRoleplay(env: Env, username: string, requestId: string, input: Input, signal: AbortSignal, task: 'roleplay' | 'character-generation' = 'roleplay'): AsyncGenerator<InferenceEvent> {
 const abort = new AbortController(), combined = AbortSignal.any([signal, abort.signal]);
 const tools = new ToolCallStream(); let logId: string | null = null, reason: string | undefined, failure: InferenceError | undefined;
 const parsed: { id: string; name: string; input: unknown }[] = [];
 // Buffer only tool fragments. Prose keeps streaming; complete names and nullable optional
 // fragments are adapted before the provider parser, without rewriting argument strings.
 async function* compatible(response: Response) {
  let emitted = false;
  const seenIndices = new Set<number>(), namedIndices = new Set<number>(), toolIds = new Map<number, string>();
  let lastIndex: number | undefined;
  let lastBatchIndices: number[] = [];
  const nextFreeIndex = () => {
   let idx = 0;
   while (seenIndices.has(idx) && idx <= 7) idx++;
   return idx;
  };
  const normalizeToolDeltas = (raw: unknown): unknown => {
   if (!Array.isArray(raw)) return raw;
   const batchIndices: number[] = [];
   const mapped = raw.map((d, pos) => {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return d;
    const item = d as Record<string, unknown>;
    const fn = item.function && typeof item.function === 'object' && !Array.isArray(item.function) ? item.function as { name?: unknown } : undefined;
    const hasName = typeof fn?.name === 'string' && fn.name.length > 0;
    const id = typeof item.id === 'string' && item.id ? item.id : undefined;
    let index = item.index;
    if (index === undefined) {
     const matched = id ? [...toolIds.entries()].find(([, existing]) => existing === id)?.[0] : undefined;
     if (matched !== undefined) index = matched;
     else if (id) index = nextFreeIndex();
     else if (raw.length > 1 && !hasName && lastBatchIndices.length === raw.length) index = lastBatchIndices[pos];
     else if (lastIndex !== undefined && !(hasName && namedIndices.has(lastIndex))) index = lastIndex;
     else index = nextFreeIndex();
    }
    if (Number.isSafeInteger(index) && Number(index) >= 0 && Number(index) <= 7) {
     const idx = Number(index);
     seenIndices.add(idx);
     if (hasName) namedIndices.add(idx);
     if (id) toolIds.set(idx, id);
     lastIndex = idx;
     batchIndices.push(idx);
    }
    return item.index === undefined ? { ...item, index } : item;
   });
   if (batchIndices.length === raw.length) lastBatchIndices = batchIndices;
   return mapped;
  };
  for await (const raw of sseData(response.body!, combined)) {
   if (raw === '[DONE]') { yield 'data: [DONE]\n\n'; break; }
   let event: Record<string, unknown>;
   try { event = JSON.parse(raw) as Record<string, unknown>; } catch { throw new InferenceError(null, 'upstream', 'invalid_sse_json'); }
   if (!event || typeof event !== 'object' || Array.isArray(event)) throw new InferenceError(null, 'upstream', 'invalid_sse_event');
   if (event.error) throw new InferenceError(event);
   if (event.choices === undefined || event.choices === null) event.choices = [];
   if (!Array.isArray(event.choices) || event.choices.length > 1) throw new InferenceError(null, 'unsupported', 'invalid_choices');
   const choice = event.choices[0] as { delta?: Record<string, unknown> & { role?: unknown; refusal?: unknown; tool_calls?: unknown }; finish_reason?: unknown } | undefined;
   if (choice?.delta && typeof choice.delta.role === 'string' && choice.delta.role !== '' && choice.delta.role !== 'assistant') choice.delta.role = 'assistant';
   if (choice?.delta?.refusal) throw new InferenceError(null, 'content_filter', 'delta_refusal');
   const normalizedTools = normalizeToolDeltas(choice?.delta?.tool_calls);
   try { tools.push(normalizedTools); } catch { throw new InferenceError(null, 'invalid_output', 'malformed_tool_delta'); }
   const finish = typeof choice?.finish_reason === 'string' ? choice.finish_reason.trim() : '';
   if (finish) {
    if (reason && reason.toLowerCase() !== finish.toLowerCase()) throw new InferenceError(null, 'interrupted', 'conflicting_finish_reason');
    reason = finish;
    if (tools.size && !emitted && isToolCapableFinish(finish, true)) {
     const used = new Set(toolIds.values());
     for (const idx of seenIndices) {
      if (!toolIds.has(idx)) {
       let id = `call_${idx}`;
       while (used.has(id)) id += '_';
       used.add(id);
       toolIds.set(idx, id);
       tools.push([{ index: idx, id }]);
      }
     }
     let calls: ToolCall[];
     try { calls = tools.finish(); } catch { throw new InferenceError(null, 'invalid_output', 'incomplete_tool_call'); }
     emitted = true;
     yield 'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: calls.map((c, index) => ({ ...c, index })) } }] }) + '\n\n';
    }
   }
   if (choice?.delta) delete choice.delta.tool_calls;
   yield 'data: ' + JSON.stringify(event) + '\n\n';
  }
 }
 const provider = createOpenAICompatible({
  name: 'tavern', baseURL: ROLEPLAY_GATEWAY_URL.slice(0, -'/chat/completions'.length),
  // The application owns the exact wire: preserve tools, original arguments, message
  // boundaries, template parameters and the Director prefix across SDK conversion.
  transformRequestBody: () => ({ ...input, model: input.model ?? 'default', stream: true }),
  fetch: async (_url, options) => {
   let response: Response;
   try { response = await runRoleplay(env, username, requestId, JSON.parse(String(options?.body)), combined, task); }
   catch { failure = new InferenceError(null, 'upstream', 'transport_error'); throw failure; }
   if (!(response instanceof Response)) { failure = new InferenceError(null, 'unsupported', 'non_response'); throw failure; }
   logId = response.headers.get('cf-aig-log-id');
   if (!response.ok) {
    failure = new InferenceError(await errorBody(response), response.status === 429 ? 'rate_limited' : 'upstream', `http_${response.status}`);
    throw failure;
   }
   if (!response.body || !response.headers.get('Content-Type')?.toLowerCase().includes('text/event-stream')) {
    await response.body?.cancel();
    failure = new InferenceError(null, 'unsupported', 'non_sse_content_type');
    throw failure;
   }
   const chunks = compatible(response), encoder = new TextEncoder();
   return new Response(new ReadableStream({
    async pull(controller) {
     try { const next = await chunks.next(); if (next.done) controller.close(); else controller.enqueue(encoder.encode(next.value)); }
     catch (error) {
      if (error instanceof InferenceError) failure = error;
      else if (error instanceof SyntaxError) failure = new InferenceError(null, 'upstream', 'invalid_sse_json');
      else if (error instanceof Error && error.message === '流式事件过大') failure = new InferenceError(null, 'upstream', 'sse_event_too_large');
      else failure = new InferenceError(null, 'interrupted', 'stream_read_error');
      controller.error(failure);
     }
    },
    async cancel() { abort.abort(); await chunks.return(undefined); },
   }), { headers: response.headers });
  },
 });
 const definitions = input.tools ? Object.fromEntries(input.tools.map(t => [t.function.name, tool({ description: t.function.description, inputSchema: jsonSchema(t.function.parameters) })])) : undefined;
 try {
  const result = streamText({ model: provider.chatModel(String(input.model ?? 'default')), messages: modelMessages(input.messages), allowSystemInMessages: true,
   tools: definitions, toolChoice: input.tool_choice, maxRetries: 0, streamRetries: 0, abortSignal: combined, includeRawChunks: true, onError: () => {},
  });
  for await (const part of result.fullStream) {
   if (part.type === 'reasoning-delta') yield { type: 'reasoning', text: part.text };
   else if (part.type === 'text-delta') yield { type: 'text', text: part.text };
   else if (part.type === 'raw') yield { type: 'observation', value: part.rawValue as Observation, logId };
   else if (part.type === 'tool-call') {
    if (part.invalid) throw new InferenceError(null, mapUpstreamFinishReason(reason) === 'length' ? 'length' : 'invalid_output', 'invalid_tool_call');
    parsed.push({ id: part.toolCallId, name: part.toolName, input: part.input });
   } else if (part.type === 'error') throw failure ?? (part.error instanceof InferenceError ? part.error : new InferenceError(null, reason ? 'upstream' : 'interrupted', 'sdk_stream_error'));
   else if (part.type === 'abort') throw new InferenceError(null, 'interrupted', 'sdk_abort');
  }
  combined.throwIfAborted();
  if (!reason) throw new InferenceError(null, 'interrupted', 'missing_finish_reason');
  let calls: ToolCall[] = [];
  if (tools.size && isToolCapableFinish(reason, true)) {
   try { calls = tools.finish(); } catch { throw new InferenceError(null, 'invalid_output', 'incomplete_tool_call'); }
   try {
    if (parsed.length !== calls.length || calls.some((c, i) => parsed[i].id !== c.id || parsed[i].name !== c.function.name || stableJson(parsed[i].input) !== stableJson(c.function.arguments.trim() === '' ? {} : JSON.parse(c.function.arguments)))) {
     throw new InferenceError(null, 'invalid_output', 'tool_call_mismatch');
    }
   } catch (error) {
    throw error instanceof InferenceError ? error : new InferenceError(null, 'invalid_output', 'invalid_tool_json');
   }
  }
  yield { type: 'finish', reason, calls };
 } catch (error) {
  const rejected = combined.aborted ? new InferenceError(null, 'interrupted', 'aborted') : failure ?? (error instanceof InferenceError ? error : new InferenceError(null, 'upstream', 'unexpected_error'));
  rejected.logId = logId;
  rejected.hasToolFragments = tools.size > 0;
  throw rejected;
 } finally { abort.abort(); }
}

async function errorBody(response: Response): Promise<unknown> {
 if (!response.body) return null;
 const reader = response.body.getReader(), decoder = new TextDecoder(); let text = '', bytes = 0;
 const timer = setTimeout(() => { void reader.cancel().catch(() => {}); }, 1000);
 try {
  for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 16384) return null; text += decoder.decode(value, { stream: true }); }
  return JSON.parse(text + decoder.decode());
 } catch { return null; } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); }
}

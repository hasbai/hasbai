import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { jsonSchema, streamText, tool, type ModelMessage } from 'ai';
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
export class InferenceError extends Error {
 logId: string | null = null;
 hasToolFragments = false;
 constructor(readonly value: unknown, readonly reason: 'upstream' | 'rate_limited' | 'interrupted' | 'unsupported' = 'upstream') { super('模型推理失败'); }
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
  for await (const raw of sseData(response.body!, combined)) {
   if (raw === '[DONE]') { yield 'data: [DONE]\n\n'; break; }
   const event = JSON.parse(raw), choice = event.choices?.[0];
   if (event.choices && (!Array.isArray(event.choices) || event.choices.length > 1)) throw new InferenceError(null, 'unsupported');
   if (event.error) throw new InferenceError(event);
   if (choice?.delta?.refusal) throw new InferenceError(null, 'unsupported');
   tools.push(choice?.delta?.tool_calls);
   if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
    if (reason && reason !== choice.finish_reason) throw new InferenceError(null, 'interrupted');
    reason = choice.finish_reason;
    if (tools.size && !emitted) {
     const calls = tools.finish(); emitted = true;
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
  transformRequestBody: () => ({ ...input, model: 'dynamic/rp', stream: true }),
  fetch: async (_url, options) => {
   let response: Response;
   try { response = await runRoleplay(env, username, requestId, JSON.parse(String(options?.body)), combined, task); }
   catch { failure = new InferenceError(null); throw failure; }
   if (!(response instanceof Response)) { failure = new InferenceError(null, 'unsupported'); throw failure; }
   logId = response.headers.get('cf-aig-log-id');
   if (!response.ok) {
    failure = new InferenceError(await errorBody(response), response.status === 429 ? 'rate_limited' : 'upstream');
    throw failure;
   }
   if (!response.body || !response.headers.get('Content-Type')?.includes('text/event-stream')) {
    await response.body?.cancel(); throw new InferenceError(null, 'unsupported');
   }
   const chunks = compatible(response), encoder = new TextEncoder();
   return new Response(new ReadableStream({
    async pull(controller) {
     try { const next = await chunks.next(); if (next.done) controller.close(); else controller.enqueue(encoder.encode(next.value)); }
     catch (error) { failure = error instanceof InferenceError ? error : new InferenceError(null, 'unsupported'); controller.error(failure); }
    },
    async cancel() { abort.abort(); await chunks.return(undefined); },
   }), { headers: response.headers });
  },
 });
 const definitions = input.tools ? Object.fromEntries(input.tools.map(t => [t.function.name, tool({ description: t.function.description, inputSchema: jsonSchema(t.function.parameters) })])) : undefined;
 try {
  const result = streamText({ model: provider.chatModel('dynamic/rp'), messages: modelMessages(input.messages), allowSystemInMessages: true,
   tools: definitions, toolChoice: input.tool_choice, maxRetries: 0, streamRetries: 0, abortSignal: combined, includeRawChunks: true, onError: () => {},
  });
  for await (const part of result.fullStream) {
   if (part.type === 'reasoning-delta') yield { type: 'reasoning', text: part.text };
   else if (part.type === 'text-delta') yield { type: 'text', text: part.text };
   else if (part.type === 'raw') yield { type: 'observation', value: part.rawValue as Observation, logId };
   else if (part.type === 'tool-call') {
    if (part.invalid) throw new InferenceError(null, 'unsupported');
    parsed.push({ id: part.toolCallId, name: part.toolName, input: part.input });
   } else if (part.type === 'error') throw failure ?? (part.error instanceof InferenceError ? part.error : new InferenceError(null, reason ? 'upstream' : 'interrupted'));
   else if (part.type === 'abort') throw new InferenceError(null, 'interrupted');
  }
  combined.throwIfAborted();
  if (!reason) throw new InferenceError(null, 'interrupted');
  const calls = tools.finish();
  if (parsed.length !== calls.length || calls.some((c, i) => parsed[i].id !== c.id || parsed[i].name !== c.function.name || stableJson(parsed[i].input) !== stableJson(JSON.parse(c.function.arguments)))) throw new InferenceError(null, 'unsupported');
  yield { type: 'finish', reason, calls };
 } catch (error) {
  const rejected = combined.aborted ? new InferenceError(null, 'interrupted') : failure ?? (error instanceof InferenceError ? error : new InferenceError(null));
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

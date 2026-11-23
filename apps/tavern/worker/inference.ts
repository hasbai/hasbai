import {
 createAssistantMessageEventStream,
 type Api,
 type AssistantMessage,
 type Model,
 type StopReason,
 type ToolCall as PiToolCall,
 type TranscriptContext,
 type Usage,
} from '@earendil-works/pi-ai';
import { createModels, createProvider, type Provider } from '@earendil-works/pi-ai/models';
import { isToolCapableFinish, mapUpstreamFinishReason } from '../shared/outcomes';
import type { PromptMessage } from '../shared/prompt';
import { sseData } from '../shared/sse';
import { stableJson, ToolCallStream, type ToolCall } from './agent';
import { ROLEPLAY_GATEWAY_URL, runRoleplay } from './gateway';
import type { InferenceMetrics } from './metrics';

export const TAVERN_PROVIDER_ID = 'tavern';

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
type Input = { messages: PromptMessage[]; tools?: readonly unknown[]; tool_choice?: 'auto' | 'none'; [key: string]: unknown };

export type TavernFinishMeta = {
 upstreamReason: string;
 rawCalls: ToolCall[];
 rawText: string;
 logId: string | null;
};

export type TavernStreamCallbacks = {
 onText?: (delta: string) => void | Promise<void>;
 onReasoning?: (delta: string) => void | Promise<void>;
 onObservation?: (value: Observation, logId: string | null) => void | Promise<void>;
 onFinishMeta?: (meta: TavernFinishMeta) => void;
 onError?: (error: InferenceError) => void;
};

export type TavernProviderConfig = {
 env: Env;
 username: string;
 requestId: string;
 task?: 'roleplay' | 'character-generation';
 models?: Model<'openai-completions'>[];
 getPayload: (model: Model<Api>, context: TranscriptContext) => Record<string, unknown>;
 getCallbacks?: () => TavernStreamCallbacks | undefined;
 getSignal?: () => AbortSignal | undefined;
};

export function tavernModel(modelId: string, contextWindow?: number | null): Model<'openai-completions'> {
 return {
  id: modelId,
  name: modelId,
  api: 'openai-completions',
  provider: TAVERN_PROVIDER_ID,
  baseUrl: ROLEPLAY_GATEWAY_URL.slice(0, -'/chat/completions'.length),
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: contextWindow ?? 131072,
  maxTokens: 32768,
 };
}

function emptyUsage(): Usage {
 return {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
 };
}

function readUsage(raw: unknown, current: Usage): Usage {
 if (!raw || typeof raw !== 'object') return current;
 const u = raw as {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  prompt_tokens_details?: { cached_tokens?: unknown };
  completion_tokens_details?: { reasoning_tokens?: unknown };
 };
 const num = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
 const input = num(u.prompt_tokens, current.input);
 const output = num(u.completion_tokens, current.output);
 const cacheRead = num(u.prompt_tokens_details?.cached_tokens, current.cacheRead);
 const reasoning = typeof u.completion_tokens_details?.reasoning_tokens === 'number' && Number.isFinite(u.completion_tokens_details.reasoning_tokens)
  ? u.completion_tokens_details.reasoning_tokens
  : current.reasoning;
 return {
  input,
  output,
  cacheRead,
  cacheWrite: current.cacheWrite,
  ...(reasoning !== undefined ? { reasoning } : {}),
  totalTokens: num(u.total_tokens, input + output),
  cost: current.cost,
 };
}

export function createTavernProvider(config: TavernProviderConfig): Provider<'openai-completions'> {
 const streamImpl = (model: Model<Api>, context: TranscriptContext, options?: { signal?: AbortSignal; onPayload?: (payload: unknown, model: Model<Api>) => unknown; onProviderStreamEvent?: (data: unknown, model: Model<Api>) => void | Promise<void> }) => {
  const eventStream = createAssistantMessageEventStream();
  const startedAt = Date.now();
  const callbacks = config.getCallbacks?.();
  const abort = new AbortController();
  const extraSignal = config.getSignal?.();
  const signals = [abort.signal, ...(options?.signal ? [options.signal] : []), ...(extraSignal ? [extraSignal] : [])];
  const signal = AbortSignal.any(signals);
  const tools = new ToolCallStream();
  let logId: string | null = null;
  let reason: string | undefined;
  let failure: InferenceError | undefined;
  let responseModel: string | undefined;
  let usage = emptyUsage();
  let rawText = '';
  let thinkingText = '';
  const content: AssistantMessage['content'] = [];
  const partial: AssistantMessage = {
   role: 'assistant',
   content,
   api: model.api,
   provider: model.provider,
   model: model.id,
   usage,
   stopReason: 'stop',
   timestamp: startedAt,
  };

  void (async () => {
   let textIndex = -1;
   let thinkingIndex = -1;
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
   const closeThinking = () => {
    if (thinkingIndex < 0) return;
    const idx = thinkingIndex;
    thinkingIndex = -1;
    eventStream.push({ type: 'thinking_end', contentIndex: idx, content: thinkingText, partial });
   };
   const closeText = () => {
    if (textIndex < 0) return;
    const idx = textIndex;
    textIndex = -1;
    eventStream.push({ type: 'text_end', contentIndex: idx, content: rawText, partial });
   };

   try {
    let payload = config.getPayload(model, context);
    payload = { ...payload, model: payload.model ?? 'default', stream: true };
    if (options?.onPayload) {
     const replaced = await options.onPayload(payload, model);
     if (replaced && typeof replaced === 'object') payload = replaced as Record<string, unknown>;
    }
    let response: Response;
    try {
     response = await runRoleplay(config.env, config.username, config.requestId, payload, signal, config.task ?? 'roleplay');
    } catch (error) {
     if (signal.aborted) throw new InferenceError(null, 'interrupted', 'aborted');
     throw error instanceof InferenceError ? error : new InferenceError(null, 'upstream', 'transport_error');
    }
    if (!(response instanceof Response)) throw new InferenceError(null, 'unsupported', 'non_response');
    logId = response.headers.get('cf-aig-log-id');
    if (!response.ok) {
     throw new InferenceError(await errorBody(response), response.status === 429 ? 'rate_limited' : 'upstream', `http_${response.status}`);
    }
    if (!response.body || !response.headers.get('Content-Type')?.toLowerCase().includes('text/event-stream')) {
     await response.body?.cancel();
     throw new InferenceError(null, 'unsupported', 'non_sse_content_type');
    }

    eventStream.push({ type: 'start', partial });
    let emittedTools = false;
    try {
     for await (const raw of sseData(response.body, signal)) {
      if (raw === '[DONE]') break;
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw) as Record<string, unknown>; } catch { throw new InferenceError(null, 'upstream', 'invalid_sse_json'); }
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new InferenceError(null, 'upstream', 'invalid_sse_event');
      if (event.error) throw new InferenceError(event);
      if (typeof event.model === 'string') responseModel = event.model;
      usage = readUsage(event.usage, usage);
      partial.usage = usage;
      if (responseModel) partial.responseModel = responseModel;

      await callbacks?.onObservation?.(event as Observation, logId);
      await options?.onProviderStreamEvent?.(event, model);

      const choices = event.choices === undefined || event.choices === null ? [] : event.choices;
      if (!Array.isArray(choices) || choices.length > 1) throw new InferenceError(null, 'unsupported', 'invalid_choices');
      const choice = choices[0] as { delta?: Record<string, unknown> & { role?: unknown; refusal?: unknown; tool_calls?: unknown; content?: unknown; reasoning_content?: unknown; reasoning?: unknown }; finish_reason?: unknown } | undefined;
      if (choice?.delta) {
       if (choice.delta.refusal) throw new InferenceError(null, 'content_filter', 'delta_refusal');
       const reasoningDelta = typeof choice.delta.reasoning_content === 'string'
        ? choice.delta.reasoning_content
        : typeof choice.delta.reasoning === 'string'
         ? choice.delta.reasoning
         : '';
       if (reasoningDelta) {
        if (thinkingIndex < 0) {
         closeText();
         thinkingIndex = content.length;
         content.push({ type: 'thinking', thinking: '' });
         eventStream.push({ type: 'thinking_start', contentIndex: thinkingIndex, partial });
        }
        thinkingText += reasoningDelta;
        (content[thinkingIndex] as { type: 'thinking'; thinking: string }).thinking = thinkingText;
        eventStream.push({ type: 'thinking_delta', contentIndex: thinkingIndex, delta: reasoningDelta, partial });
        await callbacks?.onReasoning?.(reasoningDelta);
       }
       const textDelta = typeof choice.delta.content === 'string' ? choice.delta.content : '';
       if (textDelta) {
        if (textIndex < 0) {
         closeThinking();
         textIndex = content.length;
         content.push({ type: 'text', text: '' });
         eventStream.push({ type: 'text_start', contentIndex: textIndex, partial });
        }
        rawText += textDelta;
        (content[textIndex] as { type: 'text'; text: string }).text = rawText;
        eventStream.push({ type: 'text_delta', contentIndex: textIndex, delta: textDelta, partial });
        await callbacks?.onText?.(textDelta);
       }
       const normalizedTools = normalizeToolDeltas(choice.delta.tool_calls);
       try { tools.push(normalizedTools); } catch { throw new InferenceError(null, 'invalid_output', 'malformed_tool_delta'); }
      }
      const finish = typeof choice?.finish_reason === 'string' ? choice.finish_reason.trim() : '';
      if (finish) {
       if (reason && reason.toLowerCase() !== finish.toLowerCase()) throw new InferenceError(null, 'interrupted', 'conflicting_finish_reason');
       reason = finish;
       if (tools.size && !emittedTools && isToolCapableFinish(finish, true)) {
        const used = new Set(toolIds.values());
        for (const idx of seenIndices) {
         if (!toolIds.has(idx)) {
          let id = `call_${crypto.randomUUID().slice(0, 12)}_${idx}`;
          while (used.has(id)) id += '_';
          used.add(id);
          toolIds.set(idx, id);
          tools.push([{ index: idx, id }]);
         }
        }
        emittedTools = true;
       }
      }
     }
    } catch (error) {
     if (error instanceof InferenceError) throw error;
     if (signal.aborted) throw new InferenceError(null, 'interrupted', 'aborted');
     if (error instanceof SyntaxError) throw new InferenceError(null, 'upstream', 'invalid_sse_json');
     if (error instanceof Error && error.message === '流式事件过大') throw new InferenceError(null, 'upstream', 'sse_event_too_large');
     throw new InferenceError(null, 'interrupted', 'stream_read_error');
    }

    if (signal.aborted) throw new InferenceError(null, 'interrupted', 'aborted');
    if (!reason) throw new InferenceError(null, 'interrupted', 'missing_finish_reason');

    let calls: ToolCall[] = [];
    const parsedCalls: { call: PiToolCall; rawArgs: string }[] = [];
    if (tools.size && isToolCapableFinish(reason, true)) {
     try { calls = tools.finish(); } catch { throw new InferenceError(null, 'invalid_output', 'incomplete_tool_call'); }
     for (const call of calls) {
      let parsedArgs: unknown;
      try {
       parsedArgs = call.function.arguments.trim() === '' ? {} : JSON.parse(call.function.arguments);
      } catch {
       throw new InferenceError(null, 'invalid_output', 'invalid_tool_json');
      }
      if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs)) {
       throw new InferenceError(null, 'invalid_output', 'invalid_tool_json');
      }
      const piCall: PiToolCall = {
       type: 'toolCall',
       id: call.id,
       name: call.function.name,
       arguments: parsedArgs as PiToolCall['arguments'],
      };
      if (stableJson(parsedArgs) !== stableJson(call.function.arguments.trim() === '' ? {} : JSON.parse(call.function.arguments))) {
       throw new InferenceError(null, 'invalid_output', 'tool_call_mismatch');
      }
      parsedCalls.push({ call: piCall, rawArgs: call.function.arguments });
     }
    }

    closeThinking();
    closeText();

    for (const { call, rawArgs } of parsedCalls) {
     const idx = content.length;
     content.push(call);
     eventStream.push({ type: 'toolcall_start', contentIndex: idx, partial });
     if (rawArgs) eventStream.push({ type: 'toolcall_delta', contentIndex: idx, delta: rawArgs, partial });
     eventStream.push({ type: 'toolcall_end', contentIndex: idx, toolCall: call, partial });
    }

    callbacks?.onFinishMeta?.({ upstreamReason: reason, rawCalls: calls, rawText, logId });

    const mapped = mapUpstreamFinishReason(reason);
    if (parsedCalls.length > 0 && isToolCapableFinish(reason, true)) {
     const finalMessage: AssistantMessage = {
      ...partial,
      content: [...content],
      usage,
      stopReason: 'toolUse',
      rawStopReason: reason,
     };
     eventStream.push({ type: 'done', reason: 'toolUse', message: finalMessage });
     eventStream.end(finalMessage);
    } else if (mapped === 'length' || mapped === 'stop') {
     const stopReason: Extract<StopReason, 'stop' | 'length'> = mapped === 'length' ? 'length' : 'stop';
     const finalMessage: AssistantMessage = {
      ...partial,
      content: [...content],
      usage,
      stopReason,
      rawStopReason: reason,
     };
     eventStream.push({ type: 'done', reason: stopReason, message: finalMessage });
     eventStream.end(finalMessage);
    } else {
     const errMsg: AssistantMessage = {
      ...partial,
      content: [...content],
      usage,
      stopReason: 'error',
      rawStopReason: reason,
      errorMessage: `模型返回了异常结束状态：${reason}`,
     };
     eventStream.push({ type: 'error', reason: 'error', error: errMsg });
     eventStream.end(errMsg);
    }
   } catch (error) {
    const rejected = signal.aborted
     ? new InferenceError(null, 'interrupted', 'aborted')
     : failure ?? (error instanceof InferenceError ? error : new InferenceError(null, 'upstream', 'unexpected_error'));
    rejected.logId = logId;
    rejected.hasToolFragments = tools.size > 0;
    callbacks?.onError?.(rejected);
    const stopReason: Extract<StopReason, 'aborted' | 'error'> = signal.aborted ? 'aborted' : 'error';
    const errMessage: AssistantMessage = {
     ...partial,
     content: [...content],
     usage,
     stopReason,
     ...(reason ? { rawStopReason: reason } : {}),
     errorMessage: rejected.detail ?? rejected.message,
    };
    eventStream.push({ type: 'error', reason: stopReason, error: errMessage });
    eventStream.end(errMessage);
   } finally {
    abort.abort();
   }
  })();

  return eventStream;
 };

 return createProvider({
  id: TAVERN_PROVIDER_ID,
  name: 'Tavern AI Service',
  baseUrl: ROLEPLAY_GATEWAY_URL.slice(0, -'/chat/completions'.length),
  auth: { apiKey: { name: 'Tavern AI Service', resolve: async () => ({ auth: {} }) } },
  models: config.models ?? [tavernModel('default')],
  api: {
   stream: streamImpl,
   streamSimple: streamImpl,
  },
 });
}

/** One model step using Pi AI. Domain code validates the complete tool batch before executing it. */
export async function* inferRoleplay(
 env: Env,
 username: string,
 requestId: string,
 input: Input,
 signal: AbortSignal,
 task: 'roleplay' | 'character-generation' = 'roleplay',
): AsyncGenerator<InferenceEvent> {
 const modelId = String(input.model ?? 'default');
 const model = tavernModel(modelId);
 let finishMeta: TavernFinishMeta | undefined;
 let failure: InferenceError | undefined;

 const queue: InferenceEvent[] = [];
 let waiting: (() => void) | undefined;
 let settled = false;
 const notify = () => {
  const wake = waiting;
  waiting = undefined;
  wake?.();
 };
 const push = (event: InferenceEvent) => {
  queue.push(event);
  notify();
 };

 const provider = createTavernProvider({
  env,
  username,
  requestId,
  task,
  models: [model],
  getPayload: () => ({ ...input, model: modelId, stream: true }),
  getCallbacks: () => ({
   onText: (text) => push({ type: 'text', text }),
   onReasoning: (text) => push({ type: 'reasoning', text }),
   onObservation: (value, logId) => push({ type: 'observation', value, logId }),
   onFinishMeta: (meta) => { finishMeta = meta; },
   onError: (err) => { failure = err; },
  }),
 });

 const models = createModels();
 models.setProvider(provider);
 const piStream = models.stream(model, { messages: [] }, { signal });
 const onAbort = () => notify();
 signal.addEventListener('abort', onAbort, { once: true });

 void piStream.result().finally(() => {
  settled = true;
  notify();
 });

 try {
  for (;;) {
   while (queue.length) yield queue.shift()!;
   if (signal.aborted) throw failure ?? new InferenceError(null, 'interrupted', 'aborted');
   if (settled) break;
   await new Promise<void>((resolve) => { waiting = resolve; });
  }
  while (queue.length) yield queue.shift()!;
  if (failure) throw failure;
  if (!finishMeta) throw new InferenceError(null, 'interrupted', 'missing_finish_reason');
  yield { type: 'finish', reason: finishMeta.upstreamReason, calls: finishMeta.rawCalls };
 } finally {
  signal.removeEventListener('abort', onAbort);
 }
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

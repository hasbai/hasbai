import type { Model } from '@earendil-works/pi-ai';
import { createModels, type MutableModels } from '@earendil-works/pi-ai/models';
import {
 createRegistry,
 defineExtension,
 defineTool,
 GenerationTask,
 Harness,
 hook,
 section,
 ToolTask,
 type Extension,
 type ToolExecutionResult,
 type ToolRegistration,
} from '@earendil-works/pi-durable';
import { PiHarness } from 'agents/harness/pi';
import { agentTools, TOOL_PROMPTS, type ToolPrompts } from '../shared/instructions';
import { candidateDelimiter, CandidateStream } from '../shared/candidates';
import { isToolCapableFinish, mapUpstreamFinishReason } from '../shared/outcomes';
import type { PromptMessage } from '../shared/prompt';
import type { AgentActivity, ContextUsage, FinishReason, Settings } from '../shared/types';
import type { AgentTurn, MemoryHit, ToolCall } from './agent';
import { contextLimit, type ConversationContext } from './context';
import { createTavernProvider, InferenceError, TAVERN_PROVIDER_ID, tavernModel } from './inference';
import type { LoreIndex } from './lore';
import { InferenceMetrics } from './metrics';
import { modelInput, recordFeedback, type Capability } from './models';
import type { SessionStore } from './session-store';

type PromptResult = ReturnType<ConversationContext['prompt']>;

export type ActiveBodyTurn = {
 requestId: string;
 assistantId: string;
 opts: Settings;
 capability: Capability;
 conversation: ConversationContext;
 prompt: PromptResult;
 tools: ReturnType<typeof agentTools>;
 agent: AgentTurn;
 lore: LoreIndex;
 store: SessionStore;
 toolTranscript: PromptMessage[];
 abort: AbortController;
 owns: () => Promise<void>;
 saveSummary: () => Promise<void>;
 publishContext: (usage?: ContextUsage) => Promise<void>;
 checkpointDraft: (output: string) => Promise<void>;
 send: (event: unknown) => Promise<void>;
 report: (kind: AgentActivity['kind'], key: string, status: AgentActivity['status'], title: string, result?: unknown, input?: unknown) => Promise<void>;
 publishProgress: (phase: 'prefill' | 'reasoning' | 'generation' | null, text?: string) => void;
 output: string;
 storyAtStart: number;
 requestOutput: string;
 streamedUntil: number;
 draftSavedAt: number;
 parser: CandidateStream;
 parserFinished: boolean;
 metrics: InferenceMetrics;
 model: string;
 gatewayLogId: string | null;
 firstModelStarted: number | null;
 firstBodyAt: number | null;
 modelRequests: number;
 bodyRequests: number;
 upstreamReason: string | undefined;
 finishReason: FinishReason;
 failureDetail: string | undefined;
 error: Error | undefined;
 streamLimit: number | undefined;
 hasToolFragments: boolean;
 lastRawCalls: ToolCall[];
 roundValidated: boolean;
 roundResults: Map<string, string>;
 terminateAfterRound: boolean;
 roundStepError: Error | undefined;
};

export type BodyTurnInput = {
 requestId: string;
 assistantId: string;
 userText: string;
 opts: Settings;
 capability: Capability;
 conversation: ConversationContext;
 prompt: PromptResult;
 tools: ReturnType<typeof agentTools>;
 agent: AgentTurn;
 lore: LoreIndex;
 store: SessionStore;
 toolTranscript: PromptMessage[];
 toolPrompts: ToolPrompts;
 abort: AbortController;
 owns: () => Promise<void>;
 saveSummary: () => Promise<void>;
 publishContext: (usage?: ContextUsage) => Promise<void>;
 checkpointDraft: (output: string) => Promise<void>;
 send: (event: unknown) => Promise<void>;
 report: (kind: AgentActivity['kind'], key: string, status: AgentActivity['status'], title: string, result?: unknown, input?: unknown) => Promise<void>;
 publishProgress: (phase: 'prefill' | 'reasoning' | 'generation' | null, text?: string) => void;
};

export type BodyTurnResult = {
 output: string;
 requestOutput: string;
 prompt: PromptResult;
 parser: CandidateStream;
 parserFinished: boolean;
 upstreamReason: string | undefined;
 finishReason: FinishReason;
 failureDetail: string | undefined;
 model: string;
 gatewayLogId: string | null;
 metrics: InferenceMetrics;
 firstModelStarted: number | null;
 firstBodyAt: number | null;
 modelRequests: number;
 bodyRequests: number;
};

function createTavernTool(
 def: ReturnType<typeof agentTools>[number],
 turnRef: { current: ActiveBodyTurn | null },
 replay: 'safe' | 'unsafe',
): ToolRegistration {
 return defineTool({
  name: def.function.name,
  description: def.function.description,
  parameters: def.function.parameters as Record<string, unknown>,
  executionMode: 'sequential',
  replay,
  execute: async (_args, api) => {
   const turn = turnRef.current;
   if (!turn || turn.abort.signal.aborted || !turn.roundValidated) {
    return {
     output: [{ type: 'text', text: turn?.roundStepError?.message ?? '工具调用无效' }],
     isError: true,
     control: { terminate: true },
    };
   }
   const resultJson = turn.roundResults.get(api.callId);
   const rawCall = turn.lastRawCalls.find((c) => c.id === api.callId);
   if (resultJson === undefined || !rawCall) {
    return {
     output: [{ type: 'text', text: '工具结果不存在' }],
     isError: true,
     control: { terminate: true },
    };
   }
   await turn.report('tool', rawCall.id, 'completed', rawCall.function.name, resultJson, {
    arguments: rawCall.function.arguments,
   });
   const isLast = turn.lastRawCalls.at(-1)?.id === api.callId;
   return {
    output: [{ type: 'text', text: resultJson }],
    ...(isLast && turn.terminateAfterRound ? { control: { terminate: true } } : {}),
   };
  },
 });
}

export function createTavernExtension(
 turnRef: { current: ActiveBodyTurn | null },
 toolPrompts: ToolPrompts = TOOL_PROMPTS,
): Extension {
 const defs = agentTools(toolPrompts);
 const tools = defs.map((def) =>
  createTavernTool(def, turnRef, def.function.name === 'update_state' ? 'unsafe' : 'safe'),
 );

 return defineExtension({
  name: 'tavern',
  sections: [
   section('tavern-system', () => turnRef.current?.prompt.messages[0]?.content ?? '', { tag: false }),
  ],
  tools,
  hooks: [
   hook(GenerationTask, {
    afterResponse: async (message) => {
     const turn = turnRef.current;
     if (!turn || turn.abort.signal.aborted) return;
     if (message.stopReason !== 'toolUse') return;
     await turn.checkpointDraft(turn.output);

     const calls = turn.lastRawCalls;
     turn.roundValidated = false;
     turn.roundResults = new Map();
     turn.terminateAfterRound = false;
     turn.roundStepError = undefined;

     if (!calls.length) {
      turn.finishReason = 'unsupported';
      turn.failureDetail = 'empty_tool_calls';
      turn.roundStepError = new Error('工具调用为空');
      return;
     }

     try {
      turn.finishReason = 'invalid_output';
      turn.failureDetail = 'tool_execution';
      for (const call of calls) {
       await turn.report('tool', call.id, 'running', call.function.name, undefined, {
        arguments: call.function.arguments,
       });
      }
      turn.agent.observeOutput(turn.output);
      turn.agent.validate(calls);
      const recalled = new Map<string, MemoryHit[]>();
      for (const call of calls) {
       if (call.function.name === 'search_memory') {
        const args = JSON.parse(call.function.arguments) as { query?: unknown };
        if (typeof args.query === 'string') {
         turn.finishReason = 'upstream';
         turn.failureDetail = 'lore_search';
         recalled.set(args.query, await turn.lore.search(args.query));
         turn.finishReason = 'invalid_output';
         turn.failureDetail = 'tool_execution';
        }
       }
      }
      await turn.owns();
      const results = turn.agent.execute(calls, recalled);
      turn.finishReason = 'upstream';
      turn.failureDetail = 'tool_persist';
      if (!turn.store.saveSteps(turn.assistantId, turn.agent.steps)) {
       throw new Error('生成已停止');
      }

      calls.forEach((call, index) => {
       turn.roundResults.set(call.id, results[index].content);
      });

      const toolMessage: PromptMessage = { role: 'assistant', content: turn.requestOutput, tool_calls: calls };
      const additions: PromptMessage[] = [toolMessage, ...results];
      if (turn.storyAtStart && !turn.toolTranscript.length) {
       turn.toolTranscript.push({ role: 'assistant', content: turn.output.slice(0, turn.storyAtStart) });
      }
      turn.toolTranscript.push(...additions);
      turn.prompt = turn.conversation.extend(turn.prompt, additions);
      if (turn.prompt.needsCompression) {
       if (turn.output.length) {
        turn.roundValidated = true;
        turn.terminateAfterRound = true;
        turn.finishReason = 'upstream';
        turn.failureDetail = 'tool_context_overflow';
        turn.roundStepError = new Error('工具后上下文超限');
        return;
       }
       turn.prompt = await turn.conversation.fit(turn.conversation.options, turn.toolTranscript);
      }
      await turn.saveSummary();
      turn.failureDetail = undefined;
      turn.roundValidated = true;
     } catch (error) {
      turn.roundValidated = false;
      turn.roundStepError = error instanceof Error ? error : new Error('工具执行失败');
      turn.terminateAfterRound = true;
     }
    },
   }),
   hook(ToolTask, {
    beforeTool: async () => {
     const turn = turnRef.current;
     if (!turn || turn.abort.signal.aborted) return { block: '生成已停止' };
     if (!turn.roundValidated) {
      return { block: turn.roundStepError?.message ?? '工具调用无效' };
     }
     return undefined;
    },
    afterTool: async (_call, result): Promise<ToolExecutionResult> => {
     const turn = turnRef.current;
     if (!turn || turn.abort.signal.aborted) {
      return { ...result, control: { terminate: true } };
     }
     if (!turn.roundValidated || turn.roundStepError || turn.terminateAfterRound) {
      if (turn.finishReason === 'stop' || turn.finishReason === 'interrupted') {
       turn.finishReason = 'invalid_output';
       turn.failureDetail ??= 'tool_execution';
      }
      return { ...result, control: { terminate: true } };
     }
     if (result.isError) {
      turn.finishReason = 'invalid_output';
      turn.failureDetail = 'tool_execution';
      turn.roundStepError ??= new Error('工具调用参数或执行无效');
      return { ...result, control: { terminate: true } };
     }
     return result;
    },
   }),
  ],
 });
}

export class TavernPiRuntime {
 readonly registry = createRegistry();
 private readonly turnRef: { current: ActiveBodyTurn | null } = { current: null };
 private models?: MutableModels;
 private activeModel: Model<'openai-completions'> = tavernModel('default');
 private turnUsername = '';
 readonly harness: PiHarness;

 constructor(private readonly env: Env) {
  this.harness = new PiHarness({
   harness: ({ storage, context, onWake }) => {
    this.registry.install(createTavernExtension(this.turnRef, TOOL_PROMPTS));
    this.models = createModels();
    this.models.setProvider(this.makeProvider());
    return Harness.open(
     storage,
     {
      models: this.models,
      registry: this.registry,
      onWake,
      settings: {
       retry: { maxRetries: 0 },
       compaction: { enabled: false },
       toolExecution: 'sequential',
       afterFailedRun: 'withdraw',
       progress: { partialIntervalMs: 50, outputIntervalMs: 100, persistWithinMs: 1000 },
      },
     },
     context,
    );
   },
   defaults: { model: this.activeModel },
  });
 }

 private makeProvider() {
  return createTavernProvider({
   env: this.env,
   username: this.turnUsername,
   requestId: this.turnRef.current?.requestId ?? '',
   models: [this.activeModel],
   getSignal: () => this.turnRef.current?.abort.signal,
   getPayload: () => {
    const turn = this.turnRef.current;
    if (!turn) throw new InferenceError(null, 'interrupted', 'orphaned_pi_run');
    this.startModelAttempt(turn);
    return {
     messages: turn.prompt.messages,
     tools: turn.tools,
     tool_choice: 'auto',
     ...modelInput(turn.opts),
    };
   },
   getCallbacks: () => {
    const turn = this.turnRef.current;
    if (!turn) return undefined;
    let phase: 'prefill' | 'reasoning' | 'generation' = 'prefill';
    let finished = false;
    const endProgress = () => {
     if (finished) return;
     finished = true;
     turn.publishProgress(null);
    };
    return {
     onObservation: (value, logId) => {
      turn.metrics.observe(value);
      if (typeof value.model === 'string') turn.model = value.model;
      turn.gatewayLogId = logId;
     },
     onReasoning: (delta) => {
      phase = 'reasoning';
      turn.publishProgress('reasoning', delta);
     },
     onText: async (delta) => {
      if (phase !== 'generation') {
       phase = 'generation';
       turn.publishProgress('generation');
      }
      turn.requestOutput += delta;
      turn.output += turn.parser.push(delta);
      if (Date.now() - turn.draftSavedAt >= 1000) {
       await turn.checkpointDraft(turn.output);
       turn.draftSavedAt = Date.now();
      }
      const nextDelta = turn.output.slice(turn.streamedUntil), end = turn.output.length;
      if (nextDelta) {
       turn.firstBodyAt ??= Date.now();
       await turn.send({ type: 'delta', text: nextDelta });
       turn.streamedUntil = end;
      }
     },
     onFinishMeta: (meta) => {
      endProgress();
      turn.upstreamReason = meta.upstreamReason;
      turn.lastRawCalls = meta.rawCalls;
      turn.gatewayLogId = meta.logId;
      if (isToolCapableFinish(meta.upstreamReason, meta.rawCalls.length > 0) && !meta.rawCalls.length) {
       turn.finishReason = 'unsupported';
       turn.failureDetail = 'empty_tool_calls';
       turn.error = new Error('工具调用为空');
      }
     },
     onError: (err) => {
      endProgress();
      turn.error = err;
      turn.finishReason = err.reason;
      turn.failureDetail = err.detail;
      turn.gatewayLogId = err.logId;
      turn.hasToolFragments = err.hasToolFragments;
      turn.streamLimit = contextLimit(err.value);
     },
    };
   },
  });
 }

 private syncProvider(turn: ActiveBodyTurn) {
  this.activeModel = tavernModel(turn.opts.modelId, turn.capability.contextTokens);
  if (!this.models) this.models = createModels();
  this.models.setProvider(this.makeProvider());
 }

 private startModelAttempt(turn: ActiveBodyTurn) {
  turn.storyAtStart = turn.output.length;
  turn.requestOutput = '';
  turn.metrics = new InferenceMetrics();
  turn.firstModelStarted ??= Date.now();
  turn.modelRequests++;
  turn.bodyRequests++;
  turn.upstreamReason = undefined;
  turn.finishReason = 'interrupted';
  turn.failureDetail = undefined;
  turn.error = undefined;
  turn.streamLimit = undefined;
  turn.hasToolFragments = false;
  turn.lastRawCalls = [];
  turn.roundValidated = false;
  turn.roundResults = new Map();
  turn.terminateAfterRound = false;
  turn.roundStepError = undefined;
  turn.publishProgress('prefill');
 }

 async abortSession(): Promise<void> {
  try {
   await this.harness.session().abort();
  } catch {
   // Ignore abort errors when the session has not opened or is already idle.
  }
 }

 async runBodyTurn(username: string, input: BodyTurnInput): Promise<BodyTurnResult> {
  this.turnUsername = username;
  const turn: ActiveBodyTurn = {
   requestId: input.requestId,
   assistantId: input.assistantId,
   opts: input.opts,
   capability: input.capability,
   conversation: input.conversation,
   prompt: input.prompt,
   tools: input.tools,
   agent: input.agent,
   lore: input.lore,
   store: input.store,
   toolTranscript: input.toolTranscript,
   abort: input.abort,
   owns: input.owns,
   saveSummary: input.saveSummary,
   publishContext: input.publishContext,
   checkpointDraft: input.checkpointDraft,
   send: input.send,
   report: input.report,
   publishProgress: input.publishProgress,
   output: '',
   storyAtStart: 0,
   requestOutput: '',
   streamedUntil: 0,
   draftSavedAt: 0,
   parser: new CandidateStream(candidateDelimiter()),
   parserFinished: false,
   metrics: new InferenceMetrics(),
   model: '',
   gatewayLogId: null,
   firstModelStarted: null,
   firstBodyAt: null,
   modelRequests: 0,
   bodyRequests: 0,
   upstreamReason: undefined,
   finishReason: 'interrupted',
   failureDetail: undefined,
   error: undefined,
   streamLimit: undefined,
   hasToolFragments: false,
   lastRawCalls: [],
   roundValidated: false,
   roundResults: new Map(),
   terminateAfterRound: false,
   roundStepError: undefined,
  };

  this.turnRef.current = turn;
  this.registry.install(createTavernExtension(this.turnRef, input.toolPrompts));
  this.syncProvider(turn);

  const session = this.harness.session();
  let attempt = 0;

  try {
   if (await session.busy()) {
    await session.abort();
   }
   await this.harness.root({ agent: { model: { provider: TAVERN_PROVIDER_ID, modelId: this.activeModel.id } } });

   for (;;) {
    await input.owns();
    await session.reset();
    await session.setModel(this.activeModel);

    const opId = attempt === 0 ? input.requestId : `${input.requestId}:retry:${attempt}`;
    attempt++;
    const receipt = await session.submit(input.userText || '继续', {
     operationId: opId,
     whenBusy: 'reject',
    });
    const settled = await session.wait(receipt.operationId, input.abort.signal);

    await input.checkpointDraft(turn.output);

    if (turn.error instanceof InferenceError && turn.streamLimit && !turn.hasToolFragments && !turn.output.length) {
     await recordFeedback(this.env, input.capability, { contextLimit: turn.streamLimit });
     input.conversation.contextTokens = turn.streamLimit;
     const before = turn.prompt.estimatedTokens;
     await input.conversation.compress();
     turn.prompt = await input.conversation.fit(input.conversation.options, input.toolTranscript);
     if (turn.prompt.estimatedTokens >= before) {
      throw new Error('会话压缩未缩短输入');
     }
     await input.saveSummary();
     await input.publishContext();
     continue;
    }

    if (turn.error instanceof InferenceError) {
     if (turn.error.value && typeof turn.error.value === 'object') {
      const v = turn.error.value as { model?: unknown; error?: { model?: unknown } };
      const actualModel = typeof v.model === 'string' ? v.model : typeof v.error?.model === 'string' ? v.error.model : undefined;
      const limit = contextLimit(turn.error.value);
      if (limit) await recordFeedback(this.env, input.capability, { model: actualModel, contextLimit: limit });
     }
     if (turn.streamLimit) throw new Error('生成途中上下文超限');
     throw turn.error;
    }

    if (turn.error) throw turn.error;
    if (turn.roundStepError) throw turn.roundStepError;

    if (input.abort.signal.aborted) throw new Error('aborted');

    if (settled.status === 'unanswered' && !turn.upstreamReason) {
     turn.finishReason = 'interrupted';
     turn.failureDetail = settled.reason ?? 'pi_unanswered';
     throw new Error(settled.reason ?? '生成未完成');
    }

    break;
   }

   const parsed = turn.parser.finish();
   turn.parserFinished = true;
   turn.output += parsed.body;
   const tailDelta = turn.output.slice(turn.streamedUntil);
   if (tailDelta) {
    turn.firstBodyAt ??= Date.now();
    await turn.send({ type: 'delta', text: tailDelta });
    turn.streamedUntil = turn.output.length;
   }
   if (input.abort.signal.aborted) throw new Error('aborted');
   turn.finishReason = mapUpstreamFinishReason(turn.upstreamReason);
   if (turn.finishReason !== 'stop') {
    turn.failureDetail = turn.upstreamReason ? 'upstream_finish' : 'missing_finish';
    throw new Error('incomplete');
   }
   if (!turn.output.trim()) {
    turn.finishReason = 'empty';
    throw new Error('empty');
   }

   return {
    output: turn.output,
    requestOutput: turn.requestOutput,
    prompt: turn.prompt,
    parser: turn.parser,
    parserFinished: turn.parserFinished,
    upstreamReason: turn.upstreamReason,
    finishReason: turn.finishReason,
    failureDetail: turn.failureDetail,
    model: turn.model,
    gatewayLogId: turn.gatewayLogId,
    metrics: turn.metrics,
    firstModelStarted: turn.firstModelStarted,
    firstBodyAt: turn.firstBodyAt,
    modelRequests: turn.modelRequests,
    bodyRequests: turn.bodyRequests,
   };
  } catch (err) {
   if (input.abort.signal.aborted) {
    await this.abortSession();
   }
   const wrapped = err instanceof Error ? err : new Error(String(err));
   (wrapped as Error & { turnState?: ActiveBodyTurn }).turnState = turn;
   throw wrapped;
  } finally {
   this.turnRef.current = null;
  }
 }
}

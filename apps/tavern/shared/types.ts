import { AGENT_RULE, BODY_BOUNDARY } from './instructions';
export type JsonObject = Record<string, unknown>;
export type CardData = JsonObject & {
  name: string; description: string; personality: string; scenario: string;
  first_mes: string; mes_example: string; system_prompt: string; post_history_instructions: string;
  alternate_greetings: string[]; tags: string[]; creator: string; nickname?: string;
  character_book?: unknown;
};
export type Card = { raw: JsonObject; data: CardData; format: string; unsupported: string[] };
export type Entry = {
  id: string; keys: string[]; secondary: string[]; content: string; enabled: boolean;
  constant: boolean; selective: boolean; caseSensitive: boolean; order: number; priority: number;
  position: 'before_char' | 'after_char'; regex: boolean; logic: number;
};
export type Book = { raw: JsonObject; name: string; entries: Entry[]; scanDepth: number; budget: number; recursive: boolean; unsupported: string[] };
export type ReasoningEffort = 'low' | 'medium' | 'high';
export type Settings = { userName: string; persona: string; systemPrompt: string; modelId: string; thinkingEnabled: boolean; reasoningEffort: ReasoningEffort; temperature: number; topP: number; topK: number; frequencyPenalty: number; presencePenalty: number };
export const GENERATION_DEFAULTS = { modelId: 'rp', thinkingEnabled: false, reasoningEffort: 'low' as ReasoningEffort, temperature: 0.9, topP: 1, topK: 0, frequencyPenalty: 0, presencePenalty: 0 };
export const LEGACY_SYSTEM_PROMPT = '以指定角色的身份参与虚构故事，保持角色、世界设定与对话连贯。由用户决定自己的行动与台词。';
export const PREVIOUS_SYSTEM_PROMPT = '以指定角色的身份参与虚构故事，保持角色、世界设定与对话连贯。由用户决定自己的行动与台词，不替用户作出选择。回复应充分展开：通过自然的对白、动作、神态、感官细节与环境变化推进故事，通常写成 3–6 个有内容的段落，约 300–600 字；根据情节自然调整，避免只用一两句话草草结束，也不要重复、灌水或急于跳过当前场景。留下用户能够回应的空间。';
export const DEFAULT_SYSTEM_PROMPT = '扮演指定角色，保持口吻、设定与已发生事实一致。只写角色可知的事；用户的行动、台词与选择由用户决定。用具体对白、动作和必要的感官细节推进当前场景，不复述、不灌水、不擅自跳时。通常写3–6段、约300–600字，随情节调整，留下回应空间。' + '\n\n' + AGENT_RULE + '\n\n' + BODY_BOUNDARY;
export const DEFAULT_SETTINGS: Settings = { userName: '旅人', persona: '', systemPrompt: DEFAULT_SYSTEM_PROMPT, ...GENERATION_DEFAULTS };
export type ModelOption = { id: string; name: string; available: boolean; contextTokens: number | null; parameters: { topK: boolean; penalties: boolean; thinking: boolean; topKMax: number }; };
export type Character = { id: string; name: string; description: string; creator: string; tags: string[]; format: string; hasAvatar: boolean; hasPortrait?: boolean; avatarImageId?:string; portraitImageId?:string; originalFilename?: string; source: string; sourceUrl: string; card?: JsonObject; unsupported: string[] };
export type Worldbook = { id: string; name: string; enabled: boolean; count: number; raw: JsonObject; unsupported: string[] };
export type Session = { id: string; title: string; characterName: string; updatedAt: number; settings: Settings; bookIds: string[]; character?: JsonObject; generationId?: string | null };
export type FinishReason = 'stop' | 'length' | 'content_filter' | 'unsupported' | 'upstream' | 'rate_limited' | 'interrupted' | 'timeout' | 'stopped' | 'disconnected' | 'empty' | 'output_limit' | 'invalid_output' | 'expired';
export type Message = { id: string; role: 'user' | 'assistant'; content: string; status: 'pending' | 'completed' | 'aborted' | 'error'; ordinal: number; requestId: string | null; createdAt: number; finishReason?: FinishReason | null; candidates?: string[] };
export type SearchResult = { id: string; name: string; description: string; creator: string; tags: string[]; source: string; sourceUrl: string; avatarUrl?: string; popularity?: number; createdAt?: string; updatedAt?: string };
export type Discovery = { results: SearchResult[]; page: number; hasMore: boolean; source: string; total?: number; sort?: string };
export type StreamEvent = { type: 'start'; messageId: string; requestId: string } | { type:'activity'; activity:AgentActivity } | {type:'context';context:ContextUsage} | { type: 'delta'; text: string } | { type: 'candidates_pending'; messageId: string } | { type: 'done'; message: Message } | { type: 'error'; message: string };

export type AgentActivity = { id:string; messageId:string|null; ordinal:number; kind:'body'|'director'|'tool'|'compression'|'status'; title:string; status:'running'|'completed'|'error'|'stopped'; input?:unknown; result?:unknown; error?:string; createdAt:number };
export type ContextUsage = { estimatedTokens:number; contextTokens:number|null; inputRatio:number; summaryTokens:number; coveredMessages:number; includedMessages:number };
export type SessionDetail = { session:Session; messages:Message[]; activities:AgentActivity[]; context:ContextUsage };

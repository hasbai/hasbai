import { CHARACTER_RESPONSE_FORMAT, generatedCharacterCard, validateCharacterDraft } from '../shared/character-draft';
import { body, HttpError } from './http';
import { runRoleplay } from './gateway';
import { sseData } from '../shared/sse';
import { readPrompts } from './prompts';
import type { JsonObject } from '../shared/types';

export async function generateCharacter(request: Request, env: Env, username: string): Promise<JsonObject> {
 let input: { brief: string; draft: ReturnType<typeof validateCharacterDraft> };
 try {
  const raw: unknown = await body(request);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 2 || !('brief' in raw) || !('draft' in raw) || typeof raw.brief !== 'string') throw Error('生成要求格式无效');
  input = { brief: raw.brief, draft: validateCharacterDraft(raw.draft) };
  if (![input.brief, input.draft.name, input.draft.description, input.draft.personality, input.draft.scenario, input.draft.first_mes, input.draft.mes_example].some(text => text.trim())) throw Error('请先填写角色信息或生成要求');
 } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, error instanceof Error ? error.message : '生成输入无效'); }
 const {texts}=await readPrompts(env);
 const signal = request.signal;
 try {
  const response = await runRoleplay(env, username, crypto.randomUUID(), {
   messages: [
    { role: 'system', content: texts.character },
    { role: 'user', content: JSON.stringify(input) },
   ], response_format: CHARACTER_RESPONSE_FORMAT, stream: true,
   temperature: 0.8, chat_template_kwargs: { enable_thinking: false }, reasoning_effort: 'none', reasoning_format: 'deepseek',
  }, signal, 'character-generation');
  if (!response.ok || !response.body || !response.headers.get('Content-Type')?.includes('text/event-stream')) { await response.body?.cancel(); throw Error('模型服务暂时不可用，请重试'); }
  let text = '', reason: string | undefined;
  for await (const raw of sseData(response.body, signal)) {
   if (raw === '[DONE]') break;
   const event = JSON.parse(raw);
   if (event.error || (event.choices && (!Array.isArray(event.choices) || event.choices.length > 1))) throw Error('模型返回无效，请重试');
   const choice = event.choices?.[0];
   if (choice?.delta?.tool_calls?.length || choice?.delta?.refusal) throw Error('模型未生成角色卡，请重试');
   if (choice?.finish_reason) { if (reason && reason !== choice.finish_reason) throw Error('模型返回无效，请重试'); reason = choice.finish_reason; }
   if (typeof choice?.delta?.content === 'string') text += choice.delta.content;
  }
  signal.throwIfAborted();
  if (reason !== 'stop') throw Error('角色卡生成未完成，请重试');
  let card: JsonObject;
  try { card = generatedCharacterCard(JSON.parse(text)); } catch { throw Error('生成的角色卡格式无效，请重试'); }
  const data = card.data as JsonObject;
  for (const key of ['creator', 'creator_notes', 'character_version', 'system_prompt', 'post_history_instructions'] as const) data[key] = input.draft[key];
  if (input.draft.name.trim()) data.name = input.draft.name;
  return card;
 } catch (error) {
  if (signal.aborted) throw new HttpError(499, '生成已取消');
  throw new HttpError(502, error instanceof Error && /请/.test(error.message) ? error.message : '角色卡生成失败，请重试');
 }
}

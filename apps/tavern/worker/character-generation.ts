import { CHARACTER_RESPONSE_FORMAT, generatedCharacterCard, validateCharacterDraft } from '../shared/character-draft';
import { body, HttpError } from './http';
import { inferRoleplay } from './inference';
import { modelInput } from './models';
import { readPrompts } from './prompts';
import { DEFAULT_SETTINGS, type JsonObject } from '../shared/types';

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
  const inputModel = {
   messages: [
    { role: 'system' as const, content: texts.character },
    { role: 'user' as const, content: JSON.stringify(input) },
   ], response_format: CHARACTER_RESPONSE_FORMAT, stream: true,
   ...modelInput(DEFAULT_SETTINGS),
  };
  let text = '', reason: string | undefined;
  for await (const event of inferRoleplay(env,username,crypto.randomUUID(),inputModel,signal,'character-generation')) {
   if(event.type==='text')text+=event.text;
   else if(event.type==='finish'){if(event.calls.length)throw Error('模型未生成角色卡，请重试');reason=event.reason;}
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

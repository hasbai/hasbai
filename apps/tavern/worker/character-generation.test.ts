import { afterEach, expect, it, vi } from 'vitest';
import { generateCharacter } from './character-generation';
import { runRoleplay } from './gateway';
import { CHARACTER_RESPONSE_FORMAT, characterCard, emptyCharacterDraft, generatedCharacterCard } from '../shared/character-draft';
vi.mock('./gateway', async original => ({...await original<typeof import('./gateway')>(), runRoleplay: vi.fn()}));
const env={PROMPTS:{get:async()=>null}} as unknown as Env;
const draft = { ...emptyCharacterDraft(), name: '岚', description: '港城旅店的主人', creator: '我的署名', system_prompt: '保留我的提示' };
const complete = characterCard({ ...draft, personality: '善于倾听', scenario: '港城的雨夜', first_mes: '进来坐吧。', mes_example: '<START>\n{{user}}: 你好。\n{{char}}: 欢迎。', alternate_greetings: ['清晨，窗外传来潮声。'], tags: ['奇幻'] });
function request(value: unknown = { brief: '温暖的故事', draft }, signal?: AbortSignal) { return new Request('https://tavern.test/api/characters/generate', { method: 'POST', body: JSON.stringify(value), signal }); }
function response(content = JSON.stringify(complete), reason: string | null = 'stop', delta: Record<string, unknown> = {}) {
 return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content, ...delta }, finish_reason: reason }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
it('generates a validated editable CCv2 draft through the fixed gateway without private storage writes', async () => {
 const modelCard = structuredClone(complete); (modelCard.data as Record<string, unknown>).creator = '虚构署名';
 vi.mocked(runRoleplay).mockResolvedValue(response(JSON.stringify(modelCard)));
 const card = await generateCharacter(request(), env, '账户用户名');
 expect(card).toEqual(complete);
 expect(runRoleplay).toHaveBeenCalledOnce();
 expect(runRoleplay).toHaveBeenCalledWith(env, '账户用户名', expect.any(String), expect.objectContaining({ response_format: CHARACTER_RESPONSE_FORMAT, stream: true, chat_template_kwargs: { enable_thinking: false }, messages: [expect.objectContaining({ role: 'system' }), { role: 'user', content: JSON.stringify({ brief: '温暖的故事', draft }) }] }), expect.any(AbortSignal), 'character-generation');
});
it.each([
 { brief: '', draft: emptyCharacterDraft() }, { brief: 12, draft }, { brief: '', draft: { ...draft, name: 12 } }, { brief: '', draft: { ...draft, tags: [3] } }, { brief: '', draft, model: 'untrusted' }, { brief: '', draft: { ...draft, description: null } },
])('rejects invalid input before inference', async input => {
 await expect(generateCharacter(request(input), env, 'u')).rejects.toMatchObject({ status: 400 }); expect(runRoleplay).not.toHaveBeenCalled();
});
it.each([
 ['length', response(JSON.stringify(complete), 'length')], ['missing terminal', response(JSON.stringify(complete), null)], ['refusal', response('', 'stop', { refusal: 'refused' })], ['tool', response('', 'stop', { tool_calls: [{}] })], ['fenced', response('```json\n' + JSON.stringify(complete) + '\n```')], ['invalid', response('{}')], ['truncated stream', new Response('data: {\"choices\":', {headers:{'Content-Type':'text/event-stream'}})], ['upstream', new Response('provider-secret-detail', { status: 503 })], ['non-stream', Response.json({ choices: [] })],
])('rejects %s without retry, partial cards or upstream detail leaks', async (_name, upstream) => {
 vi.mocked(runRoleplay).mockResolvedValue(upstream);
 await expect(generateCharacter(request(), env, 'u')).rejects.toMatchObject({ status: 502 }); expect(runRoleplay).toHaveBeenCalledOnce();
});
it('strictly rejects missing, extra and malformed generated fields rather than importer normalization', () => {
 for (const mutate of [
  (data: Record<string, unknown>) => { delete data.personality; },
  (data: Record<string, unknown>) => { data.tags = [3]; },
  (data: Record<string, unknown>) => { data.description = ' '; },
  (data: Record<string, unknown>) => { data.extensions = { script: 'untrusted' }; },
  (data: Record<string, unknown>) => { data.extra = 'untrusted'; },
 ]) { const card = structuredClone(complete); mutate(card.data as Record<string, unknown>); expect(() => generatedCharacterCard(card)).toThrow(); }
});
it('propagates cancellation and cancels a pending upstream reader', async () => {
 const abort = new AbortController(), cancel = vi.fn();
 vi.mocked(runRoleplay).mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'text/event-stream' } }));
 const pending = generateCharacter(request(undefined, abort.signal), env, 'u');
 await vi.waitFor(() => expect(runRoleplay).toHaveBeenCalledOnce()); abort.abort();
 await expect(pending).rejects.toMatchObject({ status: 499 }); expect(cancel).toHaveBeenCalled();
});

it('accepts a legal multi-field Chinese draft without new field, byte or list length limits',async()=>{
 const long={...draft,description:'汉'.repeat(20000),personality:'汉'.repeat(3000),scenario:'汉'.repeat(4000),first_mes:'汉'.repeat(6000),mes_example:'汉'.repeat(6000),alternate_greetings:Array(6).fill('汉'.repeat(6000)),tags:Array(10).fill('奇幻')};
 const card=characterCard(long);expect(new TextEncoder().encode(JSON.stringify(card)).length).toBeGreaterThan(128*1024);vi.mocked(runRoleplay).mockResolvedValue(response(JSON.stringify(card)));expect(await generateCharacter(request({brief:'保留设定',draft:long}),env,'u')).toEqual(card);
});

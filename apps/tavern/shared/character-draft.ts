import { object, parseCard } from './cards';
import type { JsonObject } from './types';

// The generation schema describes the card structure; users control its content.
export const CHARACTER_FIELDS = {
 name: { label: '角色名称', required: true },
 description: { label: '角色描述', required: true },
 personality: { label: '性格与习惯', required: true },
 scenario: { label: '故事场景', required: true },
 first_mes: { label: '开场白', required: true },
 mes_example: { label: '示例对白', required: true },
 creator_notes: { label: '作者备注', required: false },
 system_prompt: { label: '角色系统提示', required: false },
 post_history_instructions: { label: '对话后置指令', required: false },
 creator: { label: '作者', required: false },
 character_version: { label: '角色版本', required: false },
} as const;
export type CharacterField = keyof typeof CHARACTER_FIELDS;
export type CharacterDraft = Record<CharacterField, string> & { alternate_greetings: string[]; tags: string[] };
export function emptyCharacterDraft(): CharacterDraft {
 return { name: '', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', creator: '', character_version: '', alternate_greetings: [], tags: [] };
}
export function characterCard(draft: CharacterDraft): JsonObject {
 return { spec: 'chara_card_v2', spec_version: '2.0', data: { ...draft, extensions: {} } };
}
const arrayFields = ['alternate_greetings', 'tags'] as const;
const properties = {
 ...Object.fromEntries(Object.entries(CHARACTER_FIELDS).map(([key, rule]) => [key, { type: 'string', ...(rule.required ? { minLength: 1 } : {}) }])),
 ...Object.fromEntries(arrayFields.map(key => [key, { type: 'array', items: { type: 'string' } }])),
 extensions: { type: 'object', properties: {}, required: [], additionalProperties: false },
};
export const CHARACTER_RESPONSE_FORMAT = { type: 'json_schema', json_schema: { name: 'character_card_v2', strict: true, schema: {
 type: 'object', properties: { spec: { type: 'string', const: 'chara_card_v2' }, spec_version: { type: 'string', const: '2.0' }, data: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } },
 required: ['spec', 'spec_version', 'data'], additionalProperties: false,
} } };
function exactKeys(value: JsonObject, keys: string[]) {
 if (Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) throw Error('角色卡字段无效');
}
export function validateCharacterDraft(value: unknown, complete = false): CharacterDraft {
 const draft = object(value);
 exactKeys(draft, [...Object.keys(CHARACTER_FIELDS), ...arrayFields]);
 for (const [key, rule] of Object.entries(CHARACTER_FIELDS)) {
  const text = draft[key];
  if (typeof text !== 'string' || (complete && rule.required && !text.trim())) throw Error(`${rule.label}不能为空或格式无效`);
 }
 for (const key of arrayFields) {
  const list = draft[key];
  if (!Array.isArray(list) || list.some(text => typeof text !== 'string')) throw Error(key === 'tags' ? '标签格式无效' : '备选开场白格式无效');
 }
 return structuredClone(draft) as CharacterDraft;
}
export function generatedCharacterCard(value: unknown): JsonObject {
 const raw = object(value); exactKeys(raw, ['spec', 'spec_version', 'data']);
 if (raw.spec !== 'chara_card_v2' || raw.spec_version !== '2.0') throw Error('角色卡版本无效');
 const data = object(raw.data); exactKeys(data, Object.keys(properties)); exactKeys(object(data.extensions), []);
 const { extensions: _extensions, ...draft } = data;
 const card = characterCard(validateCharacterDraft(draft, true)); parseCard(card); return card;
}

import { expect, it } from 'vitest';
import { characterCard, characterDraft } from './character-draft';
import type { JsonObject } from './types';

it.each(['V1', 'V2', 'V3'])('edits %s fields without changing its version, unknown fields or embedded resources', version => {
 const data = { name: '岚', description: '原设定', creator_notes: ['legacy value'], tags: ['奇幻'], character_book: { entries: [{ keys: ['港城'], content: '海边' }] }, assets: [{ type: 'icon', uri: 'embeded://avatar.png' }], extensions: { custom: { script: 'preserved' } }, unknown: 42 };
 const raw: JsonObject = version === 'V1' ? data : { spec: version === 'V3' ? 'chara_card_v3' : 'chara_card_v2', spec_version: version === 'V3' ? '3.0' : '2.0', data, custom_top: 'kept' };
 expect(characterCard(characterDraft(raw), raw)).toEqual(raw);
 const draft = characterDraft(raw); draft.description = '修改后的设定'; draft.tags = ['海港'];
 const expected = structuredClone(raw), target = version === 'V1' ? expected : expected.data as JsonObject;
 target.description = draft.description; target.tags = draft.tags;
 expect(characterCard(draft, raw)).toEqual(expected);
 expect((version === 'V1' ? raw : raw.data as JsonObject).description).toBe('原设定');
});

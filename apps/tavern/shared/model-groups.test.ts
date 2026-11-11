import { describe, expect, it } from 'vitest';
import { formatContext, groupModels, providerOf } from '@hasbai/ui/model-picker/group.ts';

const models = [
  { id: 'custom-main/qwen3', name: 'qwen3', provider: 'main' },
  { id: 'default', name: '平台默认 · qwen3' },
  { id: 'custom-labs/anthropic/claude-x', name: 'anthropic/claude-x', provider: 'labs' },
  { id: 'custom-main/chat-10', name: 'chat-10', provider: 'main' },
  { id: 'custom-main/chat-2', name: 'chat-2', provider: 'main' },
];
describe('model picker grouping', () => {
  it('puts the platform default first, then providers, splitting on the vendor prefix', () => {
    const groups = groupModels(models);
    expect(groups.map(g => [g.provider, g.vendor])).toEqual([['平台默认', undefined], ['labs', 'anthropic'], ['main', undefined]]);
    expect(groups[1].models[0].short).toBe('claude-x');
    expect(groups[2].models.map(m => m.short)).toEqual(['chat-2', 'chat-10', 'qwen3']);
  });
  it('splits only on the first slash and ignores edge slashes', () => {
    const [group] = groupModels([{ id: 'custom-p/a', name: 'a/b/c', provider: 'p' }, { id: 'custom-p/x', name: 'x/', provider: 'p' }, { id: 'custom-p/y', name: '/y', provider: 'p' }]).filter(g => g.vendor === 'a');
    expect(group.models[0].short).toBe('b/c');
    expect(groupModels([{ id: 'custom-p/x', name: 'x/', provider: 'p' }])[0].vendor).toBeUndefined();
  });
  it('derives the provider from the id when missing and filters by every term', () => {
    expect(providerOf({ id: 'custom-x/m', name: 'm' })).toBe('x');
    expect(providerOf({ id: 'other', name: 'other' })).toBe('其他');
    expect(groupModels(models, 'main chat').flatMap(g => g.models.map(m => m.id))).toEqual(['custom-main/chat-2', 'custom-main/chat-10']);
    expect(groupModels(models, 'nothing')).toEqual([]);
  });
  it('formats context sizes in binary or decimal units', () => {
    expect([formatContext(32768), formatContext(200000), formatContext(1048576), formatContext(null)]).toEqual(['32K', '200K', '1M', '']);
  });
});

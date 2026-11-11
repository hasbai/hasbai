export type PickerModel = {id: string; name: string; provider?: string; contextTokens?: number | null; available?: boolean};
export type ModelGroup = {key: string; provider: string; vendor?: string; models: (PickerModel & {short: string})[]};

/** Platform default first; then one group per provider, split further by the `vendor/` prefix of model names. */
export const DEFAULT_PROVIDER = '平台默认';
export function providerOf(model: PickerModel): string {
  if (model.id === 'default') return DEFAULT_PROVIDER;
  if (model.provider) return model.provider;
  const match = model.id.match(/^custom-([^/]+)\//);
  return match ? match[1] : '其他';
}
export function groupModels(models: PickerModel[], query = ''): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  for (const model of models) {
    const provider = providerOf(model);
    const haystack = `${provider} ${model.name} ${model.id}`.toLowerCase();
    if (!terms.every(term => haystack.includes(term))) continue;
    const slash = provider === DEFAULT_PROVIDER ? -1 : model.name.indexOf('/');
    const vendor = slash > 0 && slash < model.name.length - 1 ? model.name.slice(0, slash) : undefined;
    const key = vendor ? `${provider}\u0000${vendor}` : provider;
    let group = groups.get(key);
    if (!group) groups.set(key, group = {key, provider, ...(vendor ? {vendor} : {}), models: []});
    group.models.push({...model, short: vendor ? model.name.slice(slash + 1) : model.name});
  }
  const rank = (g: ModelGroup) => g.provider === DEFAULT_PROVIDER ? 0 : 1;
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.provider.localeCompare(b.provider) || (a.vendor ?? '').localeCompare(b.vendor ?? ''))
    .map(group => ({...group, models: [...group.models].sort((a, b) => a.short.localeCompare(b.short, undefined, {numeric: true}))}));
}
export function formatContext(tokens: number | null | undefined) {
  if (!tokens) return '';
  if (tokens >= 1_000_000) return `${+(tokens / (tokens % 1_048_576 === 0 ? 1_048_576 : 1_000_000)).toFixed(1)}M`;
  return `${Math.round(tokens / (tokens % 1024 === 0 ? 1024 : 1000))}K`;
}

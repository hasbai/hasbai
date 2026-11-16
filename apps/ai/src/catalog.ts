export type Model = {id: string; name: string; type: string; context_tokens?: number; provider?: string; description?: string};
export const providerOf = (model: Model) => model.id.startsWith('dynamic/') ? '动态路由' : model.provider || model.id.split('/')[0].replace(/^custom-/, '');
export function groups(models: Model[], query: string) {
 const result = new Map<string, Model[]>();
 for (const model of models) {
  const provider = providerOf(model);
  if (!`${provider} ${model.name} ${model.id}`.toLowerCase().includes(query.trim().toLowerCase())) continue;
  result.set(provider, [...(result.get(provider) || []), model]);
 }
 return [...result];
}

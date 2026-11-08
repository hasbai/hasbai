import { HttpError } from './http';

/** This catalog is the authority for both public callers and application bindings. */
export const models = [
  {id: 'rp', name: 'RP 动态路由', type: 'chat'},
  {id: 'translate', name: 'Translate · 翻译', type: 'chat'},
  {id: 'gpt-image-2.5-flare', name: 'Flare', type: 'image'},
  {id: 'gpt-image-2.5-sunburst', name: 'Sunburst', type: 'image'},
  {id: '@cf/baai/bge-m3', name: 'BGE M3', type: 'embedding'},
] as const;
export function modelList() {
  return Response.json({object: 'list', data: models.map(model => ({...model, object: 'model', owned_by: 'hasbai'}))}, {headers: {'Cache-Control': 'no-store'}});
}
export function chatModel(value: unknown): string {
  // Accept the previous service-binding wire format during rolling deployment.
  const id = value === 'dynamic/rp' ? 'rp' : value === 'dynamic/translate' ? 'translate' : value;
  if (!models.some(model => model.type === 'chat' && model.id === id)) throw new HttpError(400, '未知对话模型');
  return 'dynamic/' + id;
}

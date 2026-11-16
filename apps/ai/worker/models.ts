import { discoverModels, type ChatModel } from './discovery';
import { routeModels, assertRoute } from './routes';
import { HttpError } from './http';

/** Image and embedding models are fixed contracts; chat models come from upstream discovery. */
const fixed = [
  {id: 'gpt-image-2.5-flare', name: 'Flare', type: 'image'},
  {id: 'gpt-image-2.5-sunburst', name: 'Sunburst', type: 'image'},
  {id: '@cf/baai/bge-m3', name: 'BGE M3', type: 'embedding'},
] as const;
type Target = {models: ChatModel[]; fallback?: ChatModel};
async function chatTarget(env: Env): Promise<Target> {
  const models = await discoverModels(env);
  if (!models.length) throw new HttpError(503, '没有可用的对话模型，请先配置 Provider');
  // A pinned default that is not discovered must not silently move traffic to another provider.
  return {models, fallback: env.DEFAULT_CHAT_MODEL ? models.find(model => model.id === env.DEFAULT_CHAT_MODEL) : models[0]};
}
export async function modelList(env: Env) {
  const [models,routes] = await Promise.allSettled([discoverModels(env),routeModels(env)]);
  if(models.status==='rejected' && routes.status==='rejected')throw new HttpError(503,'模型目录暂不可用，请稍后重试');
  const entries = [...(models.status==='fulfilled'?models.value:[]),...(routes.status==='fulfilled'?routes.value:[]),...fixed];
  return Response.json({object: 'list', data: entries.map(model => ({...model, object: 'model', owned_by: 'hasbai'}))}, {headers: {'Cache-Control': 'no-store'}});
}
/** Resolves a requested chat model to the discovered upstream ID; unknown IDs never reach the Gateway. */
export async function chatModel(env: Env, value: unknown, task: 'roleplay' | 'translate' = 'roleplay'): Promise<string> {
  if(typeof value==='string' && value.startsWith('dynamic/'))return assertRoute(env,value);
  if(value==='rp' || value==='translate')return assertRoute(env,'dynamic/'+value);
  const {models, fallback} = await chatTarget(env);
  const defaultModel = () => { if (!fallback) throw new HttpError(503, '默认对话模型未被发现，请检查 DEFAULT_CHAT_MODEL'); return fallback.id; };
  if(typeof value==='string' && models.some(model=>model.id===value))return value;
  // Legacy defaults apply only to existing internal callers during staged integration.
  if (task === 'translate' || value === 'translate' || value === 'dynamic/translate') return models.find(model => model.id === env.TRANSLATE_MODEL)?.id ?? defaultModel();
  if (value === undefined || value === '' || value === 'default' || value === 'rp' || value === 'dynamic/rp') return defaultModel();
  if (typeof value !== 'string' || !models.some(model => model.id === value)) throw new HttpError(400, '未知对话模型');
  return value;
}

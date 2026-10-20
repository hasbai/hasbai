import { DEFAULT_PROMPTS, PROMPT_KEY, type PromptDocument, type PromptTexts } from '../shared/prompts';
import { BODY_BOUNDARY, DIRECTOR_BOUNDARY, SUMMARY_BOUNDARY } from '../shared/instructions';
import { HttpError } from './http';

export function promptTexts(value:unknown):PromptTexts {
 if(!value || typeof value!=='object' || Array.isArray(value))throw new HttpError(400,'提示词格式无效');
 const data=value as Record<string,unknown>,keys=Object.keys(DEFAULT_PROMPTS);
 if(Object.keys(data).length!==keys.length || keys.some(k=>typeof data[k]!=='string'||!(data[k] as string).trim()))throw new HttpError(400,'提示词字段无效');
 return Object.fromEntries(keys.map(k=>[k,data[k]])) as PromptTexts;
}
export async function readPrompts(env:Pick<Env,'PROMPTS'>):Promise<PromptDocument>{
 const current=await env.PROMPTS.get(PROMPT_KEY);
 const raw=current??await env.PROMPTS.get('dialogue-v2');
 if(raw===null)return {revision:'defaults-v3',texts:{...DEFAULT_PROMPTS}};
 try{
  const data=JSON.parse(raw);
  if(typeof data.revision!=='string'||!data.revision)throw Error('revision');
  return {revision:data.revision,texts:current===null?upgradePrompts(data.texts):promptTexts(data.texts)};
 }catch{throw new HttpError(503,'提示词配置损坏');}
}
export async function savePrompts(env:Pick<Env,'PROMPTS'>,value:unknown):Promise<PromptDocument>{
 const document={revision:crypto.randomUUID(),texts:promptTexts(value)};
 await env.PROMPTS.put(PROMPT_KEY,JSON.stringify(document));
 return document;
}

/** Convert the old document in memory. Reads never overwrite stored configuration. */
function upgradePrompts(value:unknown):PromptTexts {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('texts');
 const data=value as Record<string,unknown>,keys=['systemTemplate','agent','director','summaryTask','character'];
 if(Object.keys(data).length!==keys.length||keys.some(key=>typeof data[key]!=='string'||!(data[key] as string).trim()))throw Error('texts');
 return {...DEFAULT_PROMPTS,systemTemplate:[data.systemTemplate,data.agent,BODY_BOUNDARY].join('\n\n'),
  character:data.character as string,director:[data.director,DIRECTOR_BOUNDARY].join('\n\n'),summaryTask:[data.summaryTask,SUMMARY_BOUNDARY].join('\n\n')};
}

import { z } from 'zod';
import { MODEL_ID } from '@hasbai/ai';
import { cloudflare } from './management';
import { HttpError } from './http';

const link = z.object({elementId:z.string().min(1).max(128)});
const outputs = z.record(z.string(),link);
const base = {id:z.string().min(1).max(128),outputs};
// Whitelist graph fields; provider credentials and request headers never leave the Worker.
export const element = z.discriminatedUnion('type',[
 z.object({...base,type:z.literal('start')}), z.object({...base,type:z.literal('end')}),
 z.object({...base,type:z.literal('percentage')}),
 z.object({...base,type:z.literal('conditional'),properties:z.object({conditions:z.record(z.string(),z.unknown())})}),
 z.object({...base,type:z.literal('rate'),properties:z.object({key:z.string(),limit:z.number(),limitType:z.enum(['count','cost']),window:z.number()})}),
 z.object({...base,type:z.literal('model'),properties:z.object({provider:z.string().min(1),model:z.string().min(1),timeout:z.number().nonnegative(),retries:z.number().int().nonnegative()})}),
]);
export const graph = z.object({elements:z.array(element).min(2).max(200)}).superRefine(({elements},ctx)=>{
 const ids=new Set(elements.map(e=>e.id));
 if(ids.size!==elements.length || elements.filter(e=>e.type==='start').length!==1 || !elements.some(e=>e.type==='end'))ctx.addIssue({code:'custom',message:'需要唯一起点、终点和节点 ID'});
 for(const node of elements)for(const edge of Object.values(node.outputs))if(!ids.has(edge.elementId))ctx.addIssue({code:'custom',message:'连线目标不存在'});
});
export const routeName = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(128);
export const routeCreate = graph.safeExtend({name:routeName});
export function safeRoute(row:Record<string,unknown>) {
 const version=row.version as {data?:unknown}|undefined;
 let data=version?.data;
 if(typeof data==='string'){try{data=JSON.parse(data);}catch{data=undefined;}}
 const parsed=graph.safeParse({elements:row.elements??(Array.isArray(data)?data:(data as {elements?:unknown})?.elements)});
 const deployment=row.deployment as {version_id?:string}|undefined;
 return {id:row.id,name:row.name,modified_at:row.modified_at,...(parsed.success?parsed.data:{}),...(deployment?.version_id?{deployment:{version_id:deployment.version_id}}:{})};
}
export async function routeModels(env:Env) {
 const result=await cloudflare(env,'GET',`gateways/${env.AIG_GATEWAY_ID}/routes?page=1&per_page=100`,undefined,5000);
 const raw=result.data??result.result;
 const rows=Array.isArray(raw)?raw:(raw as {routes?:unknown})?.routes;
 return (Array.isArray(rows)?rows:[]).filter(row=>typeof row.name==='string' && MODEL_ID.test('dynamic/'+row.name) && row.deployment?.version_id).map(row=>({id:'dynamic/'+row.name,name:row.name,type:'chat' as const,provider:'动态路由'}));
}
export async function assertRoute(env:Env,id:string) {
 if(!(await routeModels(env)).some(row=>row.id===id))throw new HttpError(400,'未知或未部署的动态路由');
 return id;
}

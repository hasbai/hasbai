// Read-only unless --apply. Preserve all existing app URLs, API scopes and grants.
import {execFileSync} from 'node:child_process';
import {authConfig,permissions} from '../packages/auth/src/config.ts';
const apply=process.argv.includes('--apply');
if(process.argv.slice(2).some(value=>value!=='--apply'))throw Error('Use --apply to configure AI access.');
function api(method,path,data){
 try {const raw=execFileSync('auth0',['api',method,path,...(data?['--data',JSON.stringify(data)]:[])],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000});return raw.trim()?JSON.parse(raw):{};}
 catch {throw Error(`Auth0 ${method} ${path} failed; credentials and response suppressed.`);}
}
const client=api('get','clients/'+authConfig.clientId);
const origins=['https://ai.hasbai.xyz','http://localhost:5178','http://127.0.0.1:5178'];
const wanted={};
for(const field of ['callbacks','allowed_logout_urls','web_origins','allowed_origins'])wanted[field]=[...new Set([...(client[field]??[]),...origins.map(origin=>field==='callbacks'?origin+'/auth/callback':origin)])];
const resources=api('get','resource-servers'),resource=resources.find(value=>value.identifier===authConfig.audience);
if(!resource)throw Error('Shared API not found.');
const roles=api('get','roles?per_page=100'),admin=roles.find(value=>value.name==='superadmin');
if(!admin)throw Error('Existing superadmin role not found.');
const grants=api('get',`roles/${admin.id}/permissions?per_page=100`);
const granted=grants.some(value=>value.permission_name===permissions.ai&&value.resource_server_identifier===authConfig.audience);
const scopes=[...(resource.scopes??[])];if(!scopes.some(value=>value.value===permissions.ai))scopes.push({value:permissions.ai,description:'AI：Provider 与 BYOK 管理，仅 Super Admin'});
const dialect=resource.token_dialect?.startsWith('rfc9068_')?'rfc9068_profile_authz':'access_token_authz';
if(apply){
 api('patch','clients/'+authConfig.clientId,wanted);
 api('patch','resource-servers/'+resource.id,{scopes,enforce_policies:true,token_dialect:dialect});
 if(!granted)api('post',`roles/${admin.id}/permissions`,{permissions:[{permission_name:permissions.ai,resource_server_identifier:authConfig.audience}]});
 const observed=api('get','clients/'+authConfig.clientId),observedApi=api('get','resource-servers/'+resource.id),observedGrants=api('get',`roles/${admin.id}/permissions?per_page=100`);
 if(Object.entries(wanted).some(([field,values])=>values.some(value=>!observed[field]?.includes(value)))||observedApi.enforce_policies!==true||!observedGrants.some(value=>value.permission_name===permissions.ai&&value.resource_server_identifier===authConfig.audience))throw Error('AI Auth0 configuration verification failed.');
}
console.log(JSON.stringify({applied:apply,clientId:authConfig.clientId,origins,permission:permissions.ai,role:admin.name,ordinaryUsers:'Verified user JWT; no role required'}));

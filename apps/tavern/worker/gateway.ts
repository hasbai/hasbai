/** Gateway retains complete requests and responses with verified account attribution. */
export function roleplayGatewayOptions(env: Pick<Env, 'AIG_GATEWAY_ID'>, username: string, requestId: string): AiOptions {
  return {
    gateway: {
      id: env.AIG_GATEWAY_ID,
      skipCache: true,
      collectLog: true,
      eventId: requestId,
      retries: { maxAttempts: 1 },
      metadata: { app: 'tavern', task: 'roleplay', username },
    },
    extraHeaders: { 'cf-aig-collect-log-payload': 'true', 'cf-aig-event-id': requestId, 'cf-aig-max-attempts': '1' },
  };
}

/** Keep HTTP failures and response-local Gateway headers available to every inference phase. */
export function runRoleplay(env:Env,username:string,requestId:string,input:Record<string,unknown>,signal:AbortSignal,task:'roleplay'|'character-generation'='roleplay'){
 if(!env.AIG_RP_RUN_TOKEN)throw Error('模型服务未配置');
 const metadata=JSON.stringify({app:'tavern',task,username}).replace(/[^\x00-\x7f]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
 return fetch('https://gateway.ai.cloudflare.com/v1/5cecc63c78acf8f5473f8745f4244448/default/compat/chat/completions',{
  method:'POST',redirect:'manual',signal,headers:{'Content-Type':'application/json','cf-aig-authorization':'Bearer '+env.AIG_RP_RUN_TOKEN,'cf-aig-skip-cache':'true','cf-aig-collect-log':'true','cf-aig-collect-log-payload':'true','cf-aig-event-id':requestId,'cf-aig-max-attempts':'1','cf-aig-metadata':metadata},body:JSON.stringify({...input,model:'dynamic/rp'}),
 });
}

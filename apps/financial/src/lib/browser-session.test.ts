import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createBrowserClient, authConfig } from '@hasbai/auth';

// Exercise the real SDK's public login, restore, refresh and logout methods.
let nonce='',generation=0;
const requests=vi.fn<typeof fetch>();
function idToken(){
 const now=Math.floor(Date.now()/1000);
 const encode=(value:unknown)=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
 return [encode({alg:'RS256',typ:'JWT'}),encode({iss:`https://${authConfig.domain}/`,aud:authConfig.clientId,sub:'auth0|fixture',iat:now,exp:now+3600,nonce,org_id:authConfig.organization}),'fixture-signature'].join('.');
}
beforeEach(()=>{
 localStorage.clear();sessionStorage.clear();generation=0;nonce='';
 for(const part of document.cookie.split(';'))document.cookie=part.split('=')[0].trim()+'=;max-age=0;path=/';
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',requests);
 requests.mockImplementation(async()=>new Response(JSON.stringify({access_token:`fixture-access-${++generation}`,refresh_token:`fixture-refresh-${generation}`,id_token:idToken(),token_type:'Bearer',expires_in:3600,scope:'openid profile email offline_access'}),{status:200,headers:{'Content-Type':'application/json'}}));
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();requests.mockReset();localStorage.clear();sessionStorage.clear();});
async function signIn(){
 const client=createBrowserClient(location.origin);
 let authorize!:URL;
 await client.loginWithRedirect({openUrl:url=>{authorize=new URL(url);}});
 nonce=authorize.searchParams.get('nonce')!;
 expect(authorize.searchParams.get('scope')?.split(' ')).toContain('offline_access');
 await client.handleRedirectCallback(`${location.origin}/auth/callback?code=fixture&state=${encodeURIComponent(authorize.searchParams.get('state')!)}`);
 return client;
}
it('restores valid tokens in a new client without an authentication request and clears them on logout',async()=>{
 await signIn();expect(requests).toHaveBeenCalledTimes(1);
 const restored=createBrowserClient(location.origin);await restored.checkSession();
 expect(await restored.isAuthenticated()).toBe(true);expect(await restored.getTokenSilently()).toBe('fixture-access-1');expect(requests).toHaveBeenCalledTimes(1);
 await restored.logout({openUrl:false});
 const signedOut=createBrowserClient(location.origin);expect(await signedOut.isAuthenticated()).toBe(false);
 expect(await signedOut.getTokenSilently({cacheMode:'cache-only'})).toBeUndefined();
 expect(JSON.stringify(localStorage)).not.toContain('fixture-refresh-1');
});
it('renews an expired token with a rotating refresh token and persists the new token',async()=>{
 await signIn();const later=Date.now()+3600_000;vi.spyOn(Date,'now').mockReturnValue(later);
 const restored=createBrowserClient(location.origin);expect(await restored.getTokenSilently()).toBe('fixture-access-2');
 const body=String(requests.mock.calls.at(-1)![1]?.body);
 expect(new URLSearchParams(body).get('grant_type')).toBe('refresh_token');expect(new URLSearchParams(body).get('refresh_token')).toBe('fixture-refresh-1');
 expect(await createBrowserClient(location.origin).getTokenSilently()).toBe('fixture-access-2');expect(requests).toHaveBeenCalledTimes(2);
 expect(JSON.stringify(localStorage)).toContain('fixture-refresh-2');expect(JSON.stringify(localStorage)).not.toContain('fixture-refresh-1');
});
it('keeps Zboard tokens isolated from the shared audience',async()=>{
 await signIn();const zboard=createBrowserClient(location.origin,{audience:'https://zboard.hasbai.xyz/api'});
 expect(await zboard.getTokenSilently({cacheMode:'cache-only'})).toBeUndefined();expect(requests).toHaveBeenCalledTimes(1);
 expect(await createBrowserClient(location.origin).getTokenSilently()).toBe('fixture-access-1');
});
it('falls back to the Auth0 session when an older login has no refresh token',async()=>{
 requests.mockImplementationOnce(async()=>new Response(JSON.stringify({access_token:'fixture-access-1',id_token:idToken(),token_type:'Bearer',expires_in:3600,scope:'openid profile email offline_access'}),{status:200}));
 await signIn();generation=1;const later=Date.now()+3600_000;vi.spyOn(Date,'now').mockReturnValue(later);
 const setAttribute=HTMLIFrameElement.prototype.setAttribute;
 vi.spyOn(HTMLIFrameElement.prototype,'setAttribute').mockImplementation(function(this:HTMLIFrameElement,name,value){
  setAttribute.call(this,name,value);
  if(name==='src'){
   const authorize=new URL(value);nonce=authorize.searchParams.get('nonce')!;
   expect(authorize.searchParams.get('prompt')).toBe('none');
   queueMicrotask(()=>window.dispatchEvent(new MessageEvent('message',{origin:`https://${authConfig.domain}`,data:{type:'authorization_response',response:{code:'silent-code',state:authorize.searchParams.get('state')}}})));
  }
 });
 expect(await createBrowserClient(location.origin).getTokenSilently()).toBe('fixture-access-2');
 expect(new URLSearchParams(String(requests.mock.calls.at(-1)![1]?.body)).get('grant_type')).toBe('authorization_code');
 expect(JSON.stringify(localStorage)).toContain('fixture-refresh-2');
});

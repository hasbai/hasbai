import {afterEach,expect,it,vi} from 'vitest';
import {generate} from './generation';
const png=new Uint8Array([137,80,78,71,13,10,26,10]);
afterEach(()=>vi.unstubAllGlobals());
it('forces Codex GPT Image 2.5 through Images API and attributes both character image purposes',async()=>{
 const fetch=vi.fn(async()=>Response.json({data:[{b64_json:btoa(String.fromCharCode(...png))}]}));vi.stubGlobal('fetch',fetch);
 for(const kind of ['avatar','portrait'] as const){expect((await generate({AIG_IMAGE_RUN_TOKEN:'fixture'},'银发旅人',kind==='avatar'?'gpt-image-2.5-flare':'gpt-image-2.5-sunburst',kind,'月石',new AbortController().signal)).bytes).toEqual(png);const [url,init]=fetch.mock.calls.at(-1)! as unknown as [string,RequestInit];expect(url).toContain('/default/custom-codex/images/generations');const body=JSON.parse(init.body as string);expect(body.model).toBe(kind==='avatar'?'gpt-image-2.5-flare':'gpt-image-2.5-sunburst');expect(body.size).toBe(kind==='portrait'?'1024x1536':'1024x1024');expect(body).not.toHaveProperty('tools');expect(JSON.parse((init.headers as Record<string,string>)['cf-aig-metadata'])).toEqual({app:'images',task:'character-'+kind,username:'月石'});}
});
it('rejects upstream failures, incomplete and non-image output instead of persisting a substitute',async()=>{
 for(const result of [new Response('failure',{status:502}),Response.json({status:'incomplete',output:[]}),Response.json({data:[{b64_json:btoa('<svg/>')}]})]){vi.stubGlobal('fetch',vi.fn(async()=>result));await expect(generate({AIG_IMAGE_RUN_TOKEN:'fixture'},'test','gpt-image-2.5-flare','image','user',new AbortController().signal)).rejects.toThrow();}
});

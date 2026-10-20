import { imageType, maxImageBytes, type ImageModel } from '@hasbai/images';
const endpoint = 'https://gateway.ai.cloudflare.com/v1/5cecc63c78acf8f5473f8745f4244448/default/custom-codex/images/generations';
export async function generate(env:Pick<Env,'AIG_IMAGE_RUN_TOKEN'>,prompt:string,model:ImageModel,kind:'avatar'|'portrait'|'image',username:string,signal:AbortSignal) {
 const metadata = JSON.stringify({app:'images',task:kind==='image'?'image-generation':`character-${kind}`,username}).replace(/[^\x00-\x7f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 const composition=kind==='avatar'?'Character avatar, centered head and shoulders, one character, no text.':kind==='portrait'?'Full body character illustration, one character from head to feet, simple background, no text.':'';
 const response=await fetch(endpoint,{method:'POST',redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(240_000)]),headers:{'Content-Type':'application/json','cf-aig-authorization':`Bearer ${env.AIG_IMAGE_RUN_TOKEN}`,'cf-aig-byok-alias':'default','cf-aig-skip-cache':'true','cf-aig-collect-log':'true','cf-aig-collect-log-payload':'true','cf-aig-metadata':metadata},body:JSON.stringify({model,prompt:`${composition}\n${prompt}`,n:1,size:kind==='portrait'?'1024x1536':'1024x1024',quality:'medium',output_format:'png'})});
 if(!response.ok)throw Error('AI 图片生成失败，请重试');
 const value=await response.json() as {data?:{b64_json?:string}[]};
 const image=value.data?.[0]?.b64_json;
 if(!image||image.length>Math.ceil(maxImageBytes/3)*4)throw Error('AI 未返回完整图片');
 const bytes=Uint8Array.from(atob(image),c=>c.charCodeAt(0));
 const type=imageType(bytes);if(!type||bytes.length>maxImageBytes)throw Error('AI 返回的图片无效');
 signal.throwIfAborted();return {bytes,type};
}

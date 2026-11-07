import { imageType, maxImageBytes, type ImageModel } from '@hasbai/images';
import { runAI } from '@hasbai/ai';
export async function generate(env:Pick<Env,'AI_SERVICE'>,prompt:string,model:ImageModel,kind:'avatar'|'portrait'|'image',username:string,signal:AbortSignal) {
 const composition=kind==='avatar'?'Character avatar, centered head and shoulders, one character, no text.':kind==='portrait'?'Full body character illustration, one character from head to feet, simple background, no text.':'';
 const response=await runAI(env.AI_SERVICE,kind==='image'?'image-generation':`character-${kind}`,{model,prompt:`${composition}\n${prompt}`,n:1,size:kind==='portrait'?'1024x1536':'1024x1024',quality:'medium',output_format:'png'},{app:'images',username},AbortSignal.any([signal,AbortSignal.timeout(240_000)]));
 if(!response.ok)throw Error('AI 图片生成失败，请重试');
 const value=await response.json() as {data?:{b64_json?:string}[]};
 const image=value.data?.[0]?.b64_json;
 if(!image||image.length>Math.ceil(maxImageBytes/3)*4)throw Error('AI 未返回完整图片');
 const bytes=Uint8Array.from(atob(image),c=>c.charCodeAt(0));
 const type=imageType(bytes);if(!type||bytes.length>maxImageBytes)throw Error('AI 返回的图片无效');
 signal.throwIfAborted();return {bytes,type};
}

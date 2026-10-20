import { readPrompts } from './prompts';
import { DEFAULT_SETTINGS, type Character, type JsonObject, type Message, type Session, type Settings, type Worldbook } from '../shared/types';
import { importCard, parseBook, parseCard, string, strings } from '../shared/cards';
import { normalizeSettings } from '../shared/settings';
import { validateCandidates } from '../shared/candidates';
import { HttpError } from './http';
import { uploadCharacterImage, type CharacterImages } from './character-avatar';
export type CharacterRow = {id:string;name:string;description:string;creator:string;tags_json:string;card_json:string;format:string;source:string;source_url:string;original_key:string;original_filename:string;avatar_key:string|null;avatar_type:string|null;avatar_image_id:string|null;portrait_image_id:string|null};
export type SessionRow = {id:string;owner:string;title:string;character_name:string;character_json:string;settings_json:string;book_ids_json:string;generation_id:string|null;generation_until:number|null;created_at:number;updated_at:number;summary_json?:string|null;storage_backend?:string;deleted_at?:number|null;agent_seed_json?:string|null};
export type MessageRow = {id:string;role:'user'|'assistant';content:string;status:Message['status'];ordinal:number;request_id:string|null;created_at:number;finish_reason:Message['finishReason'];candidates_json?:string|null};
export type BookRow = {id:string;name:string;enabled:number;book_json:string};
export function character(row: CharacterRow, full = false): Character { const card = parseCard(JSON.parse(row.card_json));return {id:row.id,name:row.name,description:row.description,creator:row.creator,tags:JSON.parse(row.tags_json),format:row.format,hasAvatar:!!(row.avatar_image_id||row.avatar_key),hasPortrait:!!row.portrait_image_id,avatarImageId:row.avatar_image_id??undefined,portraitImageId:row.portrait_image_id??undefined,originalFilename:row.original_filename,source:row.source,sourceUrl:row.source_url,unsupported:card.unsupported,...(full ? {card:card.raw}: {})}; }
export function session(row: SessionRow, full = false): Session {return {id:row.id,title:row.title,characterName:row.character_name,updatedAt:row.updated_at,settings:settings(JSON.parse(row.settings_json)),bookIds:JSON.parse(row.book_ids_json),generationId:row.generation_id,...(full ? {character:JSON.parse(row.character_json)}:{})};}
export function message(row:MessageRow):Message {return {id:row.id,role:row.role,content:row.content,status:row.status,ordinal:row.ordinal,requestId:row.request_id,createdAt:row.created_at,finishReason:row.finish_reason,candidates:row.status==='completed'&&row.finish_reason==='stop'&&row.candidates_json?validateCandidates(JSON.parse(row.candidates_json)):[]};}
export function worldbook(row:BookRow):Worldbook {const b=parseBook(JSON.parse(row.book_json),row.name);return {id:row.id,name:row.name,enabled:row.enabled===1,count:b.entries.length,raw:b.raw,unsupported:b.unsupported};}
export function settings(value:unknown):Settings {
 try { return normalizeSettings(value); } catch (e) { throw new HttpError(400,(e as Error).message); }
}
export async function userSettings(env:Env,owner:string) {const r=await env.DB.prepare('SELECT settings_json FROM settings WHERE owner=?').bind(owner).first<{settings_json:string}>();const raw=r?JSON.parse(r.settings_json):{};if(raw.systemPrompt===undefined)raw.systemPrompt=(await readPrompts(env)).texts.systemTemplate;return settings(raw);}
export async function getSession(env:Env,owner:string,id:string) {const r=await env.DB.prepare('SELECT * FROM sessions WHERE owner=? AND id=?').bind(owner,id).first<SessionRow>(); if (!r) throw new HttpError(404,'会话不存在');return r;}
export async function getMessages(env:Env,id:string) { const r=await env.DB.prepare('SELECT * FROM messages WHERE session_id=? ORDER BY ordinal,created_at,id').bind(id).all<MessageRow>();return r.results.map(message);}
/** Regenerated assistants share the same ordinal; newest version is displayed, including partial/error outcomes. */
export function currentMessages(messages:Message[]):Message[] {
 const chosen=new Map<number,Message>();
 for(const m of messages) {chosen.set(m.ordinal,m);}
 return [...chosen.values()].sort((a,b)=>a.ordinal-b.ordinal);
}
export async function ownedBooks(env:Env,owner:string,ids:unknown) {
 const list=strings(ids);if (!Array.isArray(ids) || ids.length!==list.length || list.length>10 || new Set(list).size!==list.length) throw new HttpError(400,'世界书选择无效');
 const rows:BookRow[]=[];for(const id of list){const r=await env.DB.prepare('SELECT * FROM worldbooks WHERE owner=? AND id=?').bind(owner,id).first<BookRow>();if(!r)throw new HttpError(400,'世界书不存在');rows.push(r);}return rows;
}
export async function installCard(env:Env,owner:string,bytes:Uint8Array,filename:string,source='',sourceUrl='',sourceId='',images:CharacterImages={},request?:Request) {
 const imported=importCard(bytes,filename),card=imported.card;
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(card.raw))))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const existing=await env.DB.prepare('SELECT * FROM characters WHERE owner=? AND content_hash=?').bind(owner,hash).first<CharacterRow>();if(existing){if(images.avatarImageId||images.portraitImageId)throw new HttpError(409,'角色已存在，请在编辑角色中更换图片');return character(existing,true);}
 if(imported.avatar&&!images.avatarImageId){if(!request)throw new HttpError(503,'图片上传请求缺失');images.avatarImageId=await uploadCharacterImage(request,env,{bytes:imported.avatar,type:imported.avatarType??'image/png'},card.data.name+' 头像');}
 const id=crypto.randomUUID(),root=`${encodeURIComponent(owner)}/${id}`,originalKey=root+'/original',avatarKey=null;
 await env.FILES.put(originalKey,bytes,{httpMetadata:{contentType:'application/octet-stream'}});
 try {
  await env.DB.prepare('INSERT INTO characters(id,owner,name,description,creator,tags_json,card_json,format,source,source_url,source_id,original_key,original_filename,avatar_key,avatar_type,content_hash,created_at,avatar_image_id,portrait_image_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,owner,card.data.name,card.data.description.slice(0,350),card.data.creator,JSON.stringify(card.data.tags),JSON.stringify(card.raw),card.format,source,sourceUrl,sourceId,originalKey,filename.slice(0,200),avatarKey,imported.avatarType??null,hash,Date.now(),images.avatarImageId??null,images.portraitImageId??null).run();
 }catch(e){await env.FILES.delete([originalKey,...(avatarKey?[avatarKey]:[])]);const duplicate=await env.DB.prepare('SELECT * FROM characters WHERE owner=? AND content_hash=?').bind(owner,hash).first<CharacterRow>();if(duplicate){if(images.avatarImageId||images.portraitImageId)throw new HttpError(409,'角色已存在，请在编辑角色中更换图片');return character(duplicate,true);}throw e;}
 const row=await env.DB.prepare('SELECT * FROM characters WHERE id=? AND owner=?').bind(id,owner).first<CharacterRow>();return character(row!,true);
}
export const asJson=(v:unknown)=>JSON.stringify(v);
export function jsonFile(value:JsonObject,filename:string) {return new Response(JSON.stringify(value,null,2),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}

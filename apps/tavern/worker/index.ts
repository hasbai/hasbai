import { identity, authenticatedUsername, AuthError } from './auth';
import { body, boundedBody, HttpError, json } from './http';
import { discover, download } from './discovery';
import { modelInput, modelOptions } from './models';
import { callSession, sessionStub } from './session-object';
export { TavernSession } from './session-object';
export { MessageInbox } from './message-inbox';
import { telegramWebhook } from './telegram-webhook';
import { channelApi } from './channels';
import { character, installCard, jsonFile, ownedBooks, session, settings, userSettings, worldbook, type BookRow, type CharacterRow } from './store';
import { MAX_FILE_BYTES, object, parseBook, parseCard, string } from '../shared/cards';
import { macros } from '../shared/prompt';
import { generateCharacter } from './character-generation';
import { characterForm, generateAvatar } from './character-avatar';
import { readPrompts, savePrompts } from './prompts';
export default {
 async fetch(request:Request,env:Env,ctx:Pick<ExecutionContext,'waitUntil'>):Promise<Response> {
  const url=new URL(request.url),p=url.pathname,method=request.method;
  try {
   if(p==='/health')return json({ok:true,service:'tavern',version:env.VERSION.id});
   if(p==='/api/messaging/telegram/webhook'&&method==='POST')return await telegramWebhook(request,env);
   if(!p.startsWith('/api/'))return env.ASSETS.fetch(request);
   const user=await identity(request,env),owner=user.sub;
   if(method!=='GET' && request.headers.has('Origin') && request.headers.get('Origin')!==url.origin)throw new HttpError(403,'请求来源无效');
   if(p.startsWith('/api/messaging/')){const response=await channelApi(request,env,user,p,()=>body(request));if(response)return response;}
   if(p==='/api/models' && method==='GET')return json({models:await modelOptions(env,ctx)});
   if(p==='/api/prompts'){
    if(method==='GET')return json({...await readPrompts(env),admin:user.admin});
    if(method==='PUT'){
     if(!user.admin)throw new HttpError(403,'需要酒馆管理权限');
     return json({...await savePrompts(env,(await body(request)).texts),admin:true});
    }
   }
   if(p==='/api/settings'){
    if(method==='GET')return json(await userSettings(env,owner));
    if(method==='PUT'){const data=settings(await body(request));modelInput(data);await env.DB.prepare('INSERT INTO settings(owner,settings_json) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET settings_json=excluded.settings_json').bind(owner,JSON.stringify(data)).run();return json(data);}
   }
   if(p==='/api/discover' && method==='GET'){
    const query=(url.searchParams.get('q')??'').trim();const page=Number(url.searchParams.get('page')??'1');
    if(query.length>150 || !Number.isInteger(page) || page<1 || page>10000)throw new HttpError(400,'搜索条件无效');
    const source=url.searchParams.get('source')??'chub',sort=url.searchParams.get('sort')??(source==='theatrelm'?'catalog':'popular');
    const tags=(url.searchParams.get('tags')??'').split(',').map(t=>t.trim()).filter(Boolean);
    if(tags.length>6||tags.some(t=>t.length>60))throw new HttpError(400,'分类条件无效');
    return json(await discover(env,source,query,page,sort,tags));
   }
   if(p==='/api/install' && method==='POST'){
    const d=await body(request),source=string(d.source),id=string(d.id),card=await download(env,source,id);
    return json(await installCard(env,owner,card.bytes,card.filename,source,card.sourceUrl,id),201);
   }
   if(p==='/api/characters'){
    if(method==='GET'){const rows=await env.DB.prepare('SELECT * FROM characters WHERE owner=? ORDER BY created_at DESC').bind(owner).all<CharacterRow>();return json({characters:rows.results.map(r=>character(r))});}
    if(method==='POST'){
     if(request.headers.get('Content-Type')?.startsWith('multipart/form-data')){
      const {card,avatar}=await characterForm(request);
      return json(await installCard(env,owner,new TextEncoder().encode(JSON.stringify(card)),'character.json','','','',avatar),201);
     }
     const bytes=await boundedBody(request,MAX_FILE_BYTES),filename=decodeURIComponent(request.headers.get('X-Filename')??'character.json');
     return json(await installCard(env,owner,bytes,filename),201);
    }
   }
   if(p==='/api/characters/generate'&&method==='POST')return json({card:await generateCharacter(request,env,authenticatedUsername(user))});
   if(p==='/api/characters/avatar/generate'&&method==='POST')return await generateAvatar(request,env,authenticatedUsername(user));
   const char=p.match(/^\/api\/characters\/([^/]+)(?:\/(export|avatar))?$/);
   if(char){
    const row=await env.DB.prepare('SELECT * FROM characters WHERE owner=? AND id=?').bind(owner,char[1]).first<CharacterRow>();if(!row)throw new HttpError(404,'角色不存在');
    if(method==='GET'&&char[2]==='export'){
     if(url.searchParams.get('original')==='true'){const file=await env.FILES.get(row.original_key);if(!file)throw new HttpError(404,'原卡不存在');return new Response(file.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(row.original_filename)}`,'Cache-Control':'no-store'}});}
     return jsonFile(JSON.parse(row.card_json),row.name+'.json');
    }
    if(method==='GET'&&char[2]==='avatar'){
     if(!row.avatar_key)throw new HttpError(404,'头像不存在');const file=await env.FILES.get(row.avatar_key);if(!file)throw new HttpError(404,'头像不存在');return new Response(file.body,{headers:{'Content-Type':row.avatar_type??'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
    if(!char[2]&&method==='GET')return json(character(row,true));
    if(!char[2]&&method==='PATCH'){
     const data=request.headers.get('Content-Type')?.startsWith('multipart/form-data')?await characterForm(request):{card:object((await body(request)).card),avatar:undefined};
     const raw=data.card,c=parseCard(raw);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(raw))))).map(n=>n.toString(16).padStart(2,'0')).join('');
     const avatarKey=data.avatar?`${encodeURIComponent(owner)}/${row.id}/avatar-${crypto.randomUUID()}`:row.avatar_key,avatarType=data.avatar?.type??row.avatar_type;
     if(data.avatar&&avatarKey)await env.FILES.put(avatarKey,data.avatar.bytes,{httpMetadata:{contentType:avatarType!}});
     try{
      await env.DB.prepare('UPDATE characters SET name=?,description=?,creator=?,tags_json=?,card_json=?,format=?,content_hash=?,avatar_key=?,avatar_type=? WHERE owner=? AND id=?').bind(c.data.name,c.data.description.slice(0,350),c.data.creator,JSON.stringify(c.data.tags),JSON.stringify(raw),c.format,hash,avatarKey,avatarType,owner,row.id).run();
     }catch(error){if(data.avatar&&avatarKey)await env.FILES.delete(avatarKey);throw error;}
     if(data.avatar&&row.avatar_key)ctx.waitUntil(env.FILES.delete(row.avatar_key));
     return json(character({...row,name:c.data.name,description:c.data.description.slice(0,350),creator:c.data.creator,tags_json:JSON.stringify(c.data.tags),card_json:JSON.stringify(raw),format:c.format,avatar_key:avatarKey,avatar_type:avatarType},true));
    }
    if(!char[2]&&method==='DELETE'){await env.DB.prepare('DELETE FROM characters WHERE owner=? AND id=?').bind(owner,row.id).run();await env.FILES.delete([row.original_key,...(row.avatar_key?[row.avatar_key]:[])]);return json({ok:true});}
   }
   if(p==='/api/worldbooks'){
    if(method==='GET'){const rows=await env.DB.prepare('SELECT * FROM worldbooks WHERE owner=? ORDER BY created_at DESC').bind(owner).all<BookRow>();return json({worldbooks:rows.results.map(worldbook)});}
    if(method==='POST'){const raw=object((await body(request)).raw),b=parseBook(raw),id=crypto.randomUUID();await env.DB.prepare('INSERT INTO worldbooks(id,owner,name,book_json,created_at) VALUES(?,?,?,?,?)').bind(id,owner,b.name,JSON.stringify(raw),Date.now()).run();return json({id,name:b.name,enabled:true,count:b.entries.length,raw,unsupported:b.unsupported},201);}
   }
   const book=p.match(/^\/api\/worldbooks\/([^/]+)(?:\/(export))?$/);
   if(book){
    const row=await env.DB.prepare('SELECT * FROM worldbooks WHERE owner=? AND id=?').bind(owner,book[1]).first<BookRow>();if(!row)throw new HttpError(404,'世界书不存在');
    if(method==='GET'&&book[2])return jsonFile(JSON.parse(row.book_json),row.name+'.json');
    if(!book[2]&&method==='PATCH'){const data=await body(request);if(data.enabled!==undefined&&typeof data.enabled!=='boolean')throw new HttpError(400,'状态无效');const raw=data.raw?object(data.raw):JSON.parse(row.book_json),b=parseBook(raw,row.name);await env.DB.prepare('UPDATE worldbooks SET name=?,book_json=?,enabled=? WHERE id=? AND owner=?').bind(b.name,JSON.stringify(raw),data.enabled===undefined?row.enabled:data.enabled?1:0,row.id,owner).run();return json(worldbook({...row,name:b.name,book_json:JSON.stringify(raw),enabled:data.enabled===undefined?row.enabled:data.enabled?1:0}));}
    if(!book[2]&&method==='DELETE'){const removed=await env.DB.prepare("DELETE FROM worldbooks WHERE id=? AND owner=? AND NOT EXISTS(SELECT 1 FROM sessions WHERE owner=? AND EXISTS(SELECT 1 FROM json_each(sessions.book_ids_json) WHERE value=?))").bind(row.id,owner,owner,row.id).run();if(!removed.meta.changes)throw new HttpError(409,'世界书仍有会话绑定');return json({ok:true});}
   }
   if(p==='/api/sessions'){
    if(method==='GET'){const rows=await env.DB.prepare('SELECT * FROM sessions WHERE owner=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200').bind(owner).all<Parameters<typeof session>[0]>();return json({sessions:rows.results.map(r=>session(r.storage_backend==='do'?{...r,generation_id:null}:r))});}
    if(method==='POST'){
     const data=await body(request),c=await env.DB.prepare('SELECT * FROM characters WHERE id=? AND owner=?').bind(string(data.characterId),owner).first<CharacterRow>();if(!c)throw new HttpError(404,'角色不存在');
     const opts=await userSettings(env,owner),card=parseCard(JSON.parse(c.card_json)),greetings=[card.data.first_mes,...card.data.alternate_greetings];
     const greeting=Number(data.greeting??0);if(!Number.isInteger(greeting)||greeting<0||greeting>=greetings.length)throw new HttpError(400,'开场白无效');
     const id=crypto.randomUUID(),now=Date.now();
     await env.DB.batch([env.DB.prepare("INSERT INTO sessions(id,owner,title,character_json,character_name,settings_json,created_at,updated_at,storage_backend,generation_id,generation_until) VALUES(?,?,?,?,?,?,?,?,'do',?,?)").bind(id,owner,c.name,JSON.stringify(card.raw),c.name,JSON.stringify(opts),now,now,'do:'+id,Number.MAX_SAFE_INTEGER),...(greetings[greeting]?[env.DB.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at) VALUES(?,?,'assistant',?,'completed',0,?)").bind(crypto.randomUUID(),id,macros(greetings[greeting],card.data.nickname||c.name,opts.userName),now)]:[])]);
     return json((await callSession(env,owner,id,'read')).session,201);
    }
   }
   const chat=p.match(/^\/api\/sessions\/([^/]+)(?:\/(generate|stop|command|messages|export))?$/);
   if(chat){
    const id=chat[1],stub=sessionStub(env,owner,id);
    if(method==='POST'&&chat[2]==='generate'){
     const data=await body(request),username=authenticatedUsername(user);
     // Forward unchanged bytes natively. The DO owns accepted generations;
     // losing this response only detaches the viewer, never cancels inference.
     return await stub.fetch(new Request('https://session/generate',{method:'POST',headers:{'Content-Type':'application/json','X-Tavern-Owner':owner,'X-Tavern-Session':id,'X-Tavern-Username':encodeURIComponent(username)},body:JSON.stringify(data),signal:request.signal}));
    }
    if(method==='POST'&&chat[2]==='stop')return json(await callSession(env,owner,id,'stop',await body(request)));
    if(method==='GET'&&chat[2]==='export'){
     const {row,messages,snapshots}=await callSession(env,owner,id,'export');const lines=[{user_name:JSON.parse(row.settings_json).userName,character_name:row.character_name,create_date:new Date(row.created_at).toISOString()},...messages.map(m=>({name:m.role==='user'?JSON.parse(row.settings_json).userName:row.character_name,is_user:m.role==='user',is_system:false,send_date:new Date(m.createdAt).toISOString(),mes:m.content,extra:{tavern_status:m.status,tavern_finish_reason:m.finishReason??null,ordinal:m.ordinal,...(snapshots.find(s=>s.message_id===m.id)?{tavern_agent:snapshots.find(s=>s.message_id===m.id)}:{})}}))];
     return new Response(lines.map(l=>JSON.stringify(l)).join('\n')+'\n',{headers:{'Content-Type':'application/x-ndjson','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(row.title+'.jsonl')}`,'Cache-Control':'no-store'}});
    }
    if(method==='POST'&&chat[2]==='command')return json(await callSession(env,owner,id,'command',{...await body(request),username:authenticatedUsername(user)}));
    if((method==='PATCH'||method==='DELETE')&&chat[2]==='messages')return json(await callSession(env,owner,id,'changeMessage',{...await body(request),action:method==='DELETE'?'delete':'edit',username:user.username}));
    if(!chat[2]&&method==='GET')return json(await callSession(env,owner,id,'read'));
    if(!chat[2]&&method==='PATCH')return json(await callSession(env,owner,id,'update',await body(request)));
    if(!chat[2]&&method==='DELETE')return json(await callSession(env,owner,id,'remove'));
   }
   throw new HttpError(404,'接口不存在');
  }catch(error){
   if(error instanceof HttpError||error instanceof AuthError)return json({message:error.message},error.status);
   if(error instanceof Error&&/UNIQUE constraint/i.test(error.message))return json({message:'内容已存在'},409);
   if(error instanceof Error&&/^(文件|角色|世界书|JSON|PNG|CHARX|不支持)/.test(error.message))return json({message:error.message},400);
   console.error(JSON.stringify({level:'error',event:'tavern_request_failed',path:p}));return json({message:'服务暂时不可用，请重试'},500);
  }
 }
} satisfies ExportedHandler<Env>;

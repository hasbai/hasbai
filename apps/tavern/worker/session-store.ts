import { draftProblems } from './narrative';
import type { FinishReason, Message } from '../shared/types';
import { HttpError } from './http';
import type { Summary } from './context';
import { message, type MessageRow, type SessionRow } from './store';
import { emptyState, stableJson, storyMessages, type ModelProjection, type StoryState, type ToolStep } from './agent';

export const SESSION_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, character_json TEXT NOT NULL,
 character_name TEXT NOT NULL, settings_json TEXT NOT NULL, book_ids_json TEXT NOT NULL,
 generation_id TEXT, generation_until INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 summary_json TEXT
);
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
 status TEXT NOT NULL, ordinal INTEGER NOT NULL, request_id TEXT, created_at INTEGER NOT NULL,
 finish_reason TEXT, candidates_json TEXT, UNIQUE(session_id,request_id,role)
);
CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id,ordinal,created_at,id);
CREATE TABLE IF NOT EXISTS cancelled_requests (session_id TEXT NOT NULL, request_id TEXT NOT NULL, PRIMARY KEY(session_id,request_id));
CREATE TABLE IF NOT EXISTS session_meta (id TEXT PRIMARY KEY, deleted INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, synced_revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS turn_snapshots (message_id TEXT PRIMARY KEY, before_json TEXT NOT NULL, after_json TEXT, steps_json TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS director_synopsis (session_id TEXT PRIMARY KEY, value_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS model_projections (message_id TEXT PRIMARY KEY, value_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS generation_drafts (message_id TEXT PRIMARY KEY, content TEXT NOT NULL);
`;
export type TurnSnapshot={message_id:string;before_json:string;after_json:string|null;steps_json:string};
/** Only the current session's SQLite operations; no remote database or model awaits in transactions. */
export class SessionStore {
 constructor(readonly storage: Pick<DurableObjectStorage,'sql'|'transactionSync'>, readonly id:string) {}
 private rows<T extends Record<string,SqlStorageValue>>(query:string,...values:SqlStorageValue[]):T[]{return this.storage.sql.exec<T>(query,...values).toArray();}
 private write(query:string,...values:SqlStorageValue[]):number{this.storage.sql.exec(query,...values).toArray();return this.rows<{n:number}>('SELECT changes() n')[0].n;}
 transaction<T>(fn:()=>T):T{return this.storage.transactionSync(fn);}
 exists(){return !!this.rows('SELECT id FROM session_meta WHERE id=?',this.id)[0];}
 deleted(){return this.rows<{deleted:number}>('SELECT deleted FROM session_meta WHERE id=?',this.id)[0]?.deleted===1;}
 get():SessionRow {if(this.deleted())throw new HttpError(404,'会话不存在');const row=this.rows<SessionRow & Record<string,SqlStorageValue>>('SELECT * FROM sessions WHERE id=?',this.id)[0];if(!row)throw new HttpError(404,'会话不存在');return row;}
 messages():Message[]{return this.rawMessages().map(message);}
 snapshots():TurnSnapshot[]{return this.rows<TurnSnapshot & Record<string,SqlStorageValue>>('SELECT * FROM turn_snapshots');}
 snapshot(id:string){return this.rows<TurnSnapshot & Record<string,SqlStorageValue>>('SELECT * FROM turn_snapshots WHERE message_id=?',id)[0];}
 projection(id:string):ModelProjection|null{const row=this.rows<{value_json:string}>('SELECT value_json FROM model_projections WHERE message_id=?',id)[0];return row?JSON.parse(row.value_json):null;}
 synopsis():string|null{return this.rows<{value_json:string}>('SELECT value_json FROM director_synopsis WHERE session_id=?',this.id)[0]?.value_json??null;}
 saveSynopsis(assistantId:string,summary:Summary){if(!this.pending(assistantId))return false;this.write('INSERT INTO director_synopsis VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET value_json=excluded.value_json',this.id,JSON.stringify(summary));return true;}
 state(history:Message[]=storyMessages(this.messages())):StoryState{for(const m of [...history].reverse()){const s=this.snapshot(m.id);if(s?.after_json)return JSON.parse(s.after_json);}return emptyState();}
 before(id:string):StoryState{const s=this.snapshot(id);return s?JSON.parse(s.before_json):this.state(storyMessages(this.messages()).filter(m=>m.ordinal<(this.findMessage(id)?.ordinal??0)));}
 beginState(id:string,state:StoryState){if(!this.pending(id))throw new HttpError(409,'生成已停止');this.write('INSERT INTO turn_snapshots(message_id,before_json) VALUES(?,?)',id,stableJson(state));}
 saveSteps(id:string,steps:ToolStep[]){if(!this.pending(id))return false;this.write('UPDATE turn_snapshots SET steps_json=? WHERE message_id=?',JSON.stringify(steps),id);return true;}
 rawMessages():MessageRow[]{return this.rows<MessageRow & Record<string,SqlStorageValue>>('SELECT * FROM messages WHERE session_id=? ORDER BY ordinal,created_at,id',this.id);}
 findRequest(requestId:string){return this.rows<MessageRow & Record<string,SqlStorageValue>>("SELECT * FROM messages WHERE session_id=? AND request_id=? AND role='assistant'",this.id,requestId)[0];}
 findMessage(id:string){return this.rows<MessageRow & Record<string,SqlStorageValue>>('SELECT * FROM messages WHERE session_id=? AND id=?',this.id,id)[0];}
 import(row:SessionRow,messages:MessageRow[]){
  if(this.exists())return;
  this.transaction(()=>{
   this.write('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',row.id,row.owner,row.title,row.character_json,row.character_name,row.settings_json,row.book_ids_json,null,null,row.created_at,row.updated_at,row.summary_json??null);
   for(const m of messages)this.insert(m);
   for(const s of JSON.parse(row.agent_seed_json??'[]') as TurnSnapshot[]){if(!this.findMessage(s.message_id))throw new Error('状态来源不存在');this.write('INSERT INTO turn_snapshots VALUES(?,?,?,?)',s.message_id,s.before_json,s.after_json,s.steps_json);}
   const restored=this.rawMessages();if(JSON.stringify(restored)!==JSON.stringify(messages.map(m=>({id:m.id,session_id:this.id,role:m.role,content:m.content,status:m.status,ordinal:m.ordinal,request_id:m.request_id,created_at:m.created_at,finish_reason:m.finish_reason??null,candidates_json:m.candidates_json??null}))))throw new Error('会话导入校验失败');
   this.write('INSERT INTO session_meta(id) VALUES(?)',this.id);
  });
 }
 private insert(m:MessageRow){this.write('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?)',m.id,this.id,m.role,m.content,m.status,m.ordinal,m.request_id,m.created_at,m.finish_reason??null,m.candidates_json??null);}
 dirty(){this.write('UPDATE session_meta SET revision=revision+1 WHERE id=?',this.id);}
 syncState(){return this.rows<{revision:number;synced_revision:number;deleted:number}>('SELECT * FROM session_meta WHERE id=?',this.id)[0];}
 synced(revision:number){this.write('UPDATE session_meta SET synced_revision=? WHERE id=?',revision,this.id);}
 directory(){return this.rows<SessionRow & Record<string,SqlStorageValue>>('SELECT * FROM sessions WHERE id=?',this.id)[0];}
 idle(){const r=this.get();if(r.generation_id)throw new HttpError(409,'请先停止生成');return r;}
 private recoverDrafts(assistantId?:string,reason:FinishReason='interrupted'){
  // Recovery must recheck a final partial: the process may have died before validation.
  const drafts=this.rows<{message_id:string;content:string}>("SELECT d.message_id,d.content FROM generation_drafts d JOIN messages m ON m.id=d.message_id WHERE m.session_id=? AND m.status IN ('pending','aborted')"+(assistantId?' AND m.id=?':''),this.id,...(assistantId?[assistantId]:[]));
  for(const draft of drafts)if(draftProblems(draft.content).length)this.discardDraft(draft.message_id);
  this.write("UPDATE messages SET content=COALESCE((SELECT content FROM generation_drafts WHERE message_id=messages.id),content),status='aborted',finish_reason=CASE WHEN status='aborted' AND finish_reason IS NOT NULL THEN finish_reason ELSE ? END,candidates_json=NULL WHERE session_id=? AND (status='pending' OR (status='aborted' AND EXISTS(SELECT 1 FROM generation_drafts WHERE message_id=messages.id)))"+(assistantId?' AND id=?':''),reason,this.id,...(assistantId?[assistantId]:[]));
  this.write('DELETE FROM generation_drafts WHERE message_id IN (SELECT id FROM messages WHERE session_id=?'+(assistantId?' AND id=?':'')+')',this.id,...(assistantId?[assistantId]:[]));
 }
 recover(assistantId?:string){this.transaction(()=>{if(assistantId&&!this.owns(assistantId))return;this.recoverDrafts(assistantId);this.write('UPDATE sessions SET generation_id=NULL,generation_until=NULL WHERE id=?'+(assistantId?' AND generation_id=?':''),this.id,...(assistantId?[assistantId]:[]));});}
 claim(assistantId:string,now:number){return this.transaction(()=>{
  const r=this.get();if(r.generation_id&&(r.generation_until??0)>now)return false;
  this.recoverDrafts(undefined,'expired');
  this.write('UPDATE sessions SET generation_id=?,generation_until=?,updated_at=? WHERE id=?',assistantId,now+180000,now,this.id);
  this.write("UPDATE messages SET status='aborted',finish_reason='expired' WHERE session_id=? AND status='pending'",this.id);this.dirty();return true;
 });}
 owns(assistantId:string){return this.get().generation_id===assistantId;}
 renew(assistantId:string){return this.write('UPDATE sessions SET generation_until=? WHERE id=? AND generation_id=?',Date.now()+180000,this.id,assistantId)>0;}
 release(assistantId:string){this.write('UPDATE sessions SET generation_id=NULL,generation_until=NULL WHERE id=? AND generation_id=?',this.id,assistantId);}
 start(assistantId:string,user:Message|undefined,assistant:Message,state?:StoryState){this.transaction(()=>{
  if(!this.owns(assistantId))throw new HttpError(409,'会话生成已接管');
  if(user)this.insert({id:user.id,role:user.role,content:user.content,status:user.status,ordinal:user.ordinal,request_id:user.requestId??null,created_at:user.createdAt,finish_reason:null});
  this.insert({id:assistant.id,role:assistant.role,content:assistant.content,status:assistant.status,ordinal:assistant.ordinal,request_id:assistant.requestId??null,created_at:assistant.createdAt,finish_reason:null});
  if(state)this.beginState(assistantId,state);
 });}
 pending(assistantId:string){return this.owns(assistantId)&&this.findMessage(assistantId)?.status==='pending';}
 saveSummary(assistantId:string,summary:string|null){if(!this.pending(assistantId))return false;return this.write('UPDATE sessions SET summary_json=? WHERE id=? AND generation_id=? AND EXISTS(SELECT 1 FROM messages WHERE id=? AND status=\'pending\')',summary,this.id,assistantId,assistantId)>0;}
 saveOutput(assistantId:string,content:string){if(!this.pending(assistantId))return false;return this.write("UPDATE messages SET content=? WHERE id=? AND session_id=? AND status='pending'",content,assistantId,this.id)>0;}
 /** Private checkpoint: pending API messages never expose unaudited drafts. */
 saveDraft(assistantId:string,content:string){if(!this.owns(assistantId))return false;this.write('INSERT INTO generation_drafts VALUES(?,?) ON CONFLICT(message_id) DO UPDATE SET content=excluded.content',assistantId,content);return true;}
 /** Persist rejection before any later cleanup can fail; old versions remain untouched. */
 rejectDraft(assistantId:string){return this.transaction(()=>{if(!this.owns(assistantId))return false;this.write("INSERT INTO generation_drafts VALUES(?,?) ON CONFLICT(message_id) DO UPDATE SET content=excluded.content",assistantId,'');this.write("UPDATE turn_snapshots SET steps_json='[]' WHERE message_id=?",assistantId);return true;});}
 discardDraft(assistantId:string){this.write('DELETE FROM generation_drafts WHERE message_id=?',assistantId);}
 finish(assistantId:string,output:string,status:Message['status'],finishReason:FinishReason,candidates:string[],state?:StoryState,projection?:ModelProjection){return this.transaction(()=>{
  if(this.owns(assistantId)){
   if(status==='completed'&&finishReason==='stop'&&this.pending(assistantId)){
    if(state)this.write('UPDATE turn_snapshots SET after_json=? WHERE message_id=?',stableJson(state),assistantId);
    if(projection){this.write('DELETE FROM model_projections');this.write('INSERT INTO model_projections VALUES(?,?)',assistantId,JSON.stringify(projection));}
   }
   this.write("UPDATE messages SET content=?,candidates_json=CASE WHEN status='aborted' OR ?<>'completed' THEN NULL ELSE ? END,finish_reason=CASE WHEN status='aborted' AND finish_reason IS NOT NULL THEN finish_reason ELSE ? END,status=CASE WHEN status='aborted' THEN 'aborted' ELSE ? END WHERE id=? AND session_id=?",output,status,candidates.length?JSON.stringify(candidates):null,finishReason,status,assistantId,this.id);
   this.write('UPDATE sessions SET generation_id=NULL,generation_until=NULL,updated_at=? WHERE id=? AND generation_id=?',Date.now(),this.id,assistantId);this.dirty();
   this.discardDraft(assistantId);
  }
  return this.findMessage(assistantId);
 });}
 cancelRequest(requestId:string){this.write('INSERT OR IGNORE INTO cancelled_requests VALUES(?,?)',this.id,requestId);}
 cancelled(requestId:string){return !!this.rows('SELECT request_id FROM cancelled_requests WHERE session_id=? AND request_id=?',this.id,requestId)[0];}
 stop(assistantId:string,reason:FinishReason='stopped'){if(!this.owns(assistantId))throw new HttpError(409,'生成状态已改变');this.write("UPDATE messages SET status='aborted',finish_reason=? WHERE session_id=? AND id=? AND status='pending'",reason,this.id,assistantId);}
 update(settings:string,books:string,title:string){this.transaction(()=>{this.idle();this.write('UPDATE sessions SET settings_json=?,book_ids_json=?,title=?,updated_at=? WHERE id=?',settings,books,title,Date.now(),this.id);this.dirty();});}
 remove(){this.transaction(()=>{this.idle();this.write('UPDATE session_meta SET deleted=1,revision=revision+1 WHERE id=?',this.id);});}
}

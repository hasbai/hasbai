import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('backfills only matching owned character snapshots and leaves missing or deleted sessions unlinked',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec("CREATE TABLE sessions(id TEXT,owner TEXT,character_json TEXT,deleted_at INTEGER); CREATE TABLE characters(id TEXT,owner TEXT,card_json TEXT); INSERT INTO characters VALUES('own','alice','{\"name\":\"岚\"}'),('foreign','bob','{\"name\":\"雪\"}'); INSERT INTO sessions VALUES('match','alice','{\"name\":\"岚\"}',NULL),('foreign','alice','{\"name\":\"雪\"}',NULL),('edited','alice','{\"name\":\"旧岚\"}',NULL),('deleted','alice','{\"name\":\"岚\"}',1)");
  db.exec(readFileSync(new URL('../migrations/0011_session_character.sql',import.meta.url),'utf8'));
  expect(db.prepare('SELECT id,character_id FROM sessions ORDER BY id').all()).toEqual([{id:'deleted',character_id:null},{id:'edited',character_id:null},{id:'foreign',character_id:null},{id:'match',character_id:'own'}]);
 }finally{db.close();}
});

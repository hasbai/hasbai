// Compatibility cutover: only the derived avatars move; original card exports stay intact.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from 'pg';
import {publicPng} from '@hasbai/images/png';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const apply=process.argv.includes('--apply');
if(!process.env.DATABASE_URL)throw Error('Load the image database connection first; Wrangler uses its current login.');
function wrangler(args){try{return execFileSync('pnpm',['--dir','apps/tavern','exec','wrangler',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000});}catch{throw Error('Image migration request failed; raw output suppressed.');}}
function d1(sql){const out=wrangler(['d1','execute','tavern','--remote','--json','--command',sql]);return JSON.parse(out.slice(out.indexOf('[')))[0].results;}
const rows=d1('SELECT id,owner,name,avatar_key,avatar_type,avatar_image_id FROM characters WHERE avatar_key IS NOT NULL');
if(!apply){console.log(JSON.stringify({pending:rows.length,applied:false}));process.exit(0);}
const directory=mkdtempSync(join(tmpdir(),'hasbai-image-migration-'));
const db=new Client({connectionString:process.env.DATABASE_URL});let migrated=0;
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
try{
 await db.connect();
 for(const row of rows){
  if(row.avatar_image_id){
   const [record]=(await db.query('SELECT sha256 FROM public.image WHERE id=$1 AND ready',[row.avatar_image_id])).rows;
   const response=await fetch('https://images.hasbai.xyz/images/'+row.avatar_image_id);
   if(!record||!response.ok||createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex')!==record.sha256)throw Error('Existing image reference is not ready');
   wrangler(['r2','object','delete','tavern/'+encodeURIComponent(row.avatar_key),'--remote']);
   d1('UPDATE characters SET avatar_key=NULL,avatar_type=NULL WHERE id='+quote(row.id)+' AND owner='+quote(row.owner)+' AND avatar_key='+quote(row.avatar_key)+' AND avatar_image_id='+quote(row.avatar_image_id));migrated++;continue;
  }
  const original=join(directory,'source'),copy=join(directory,'copy');wrangler(['r2','object','get','tavern/'+encodeURIComponent(row.avatar_key),'--remote','--file',original]);
  const bytes=publicPng(readFileSync(original));writeFileSync(original,bytes);const hash=createHash('sha256').update(bytes).digest('hex');
  const record=(await db.query('INSERT INTO public.image(name,sha256,content_type,size,owner,source) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(sha256) DO UPDATE SET sha256=excluded.sha256 RETURNING id,ready',[row.name+' 头像',hash,row.avatar_type??'image/png',bytes.length,row.owner,'tavern-import'])).rows[0];
  if(!record.ready){wrangler(['r2','object','put','image/'+record.id,'--remote','--file',original,'--content-type',row.avatar_type??'image/png']);await db.query('UPDATE public.image SET ready=true WHERE id=$1',[record.id]);}
  wrangler(['r2','object','get','image/'+record.id,'--remote','--file',copy]);if(createHash('sha256').update(readFileSync(copy)).digest('hex')!==hash)throw Error('Migrated R2 bytes differ');
  const response=await fetch('https://images.hasbai.xyz/images/'+record.id);if(!response.ok||createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex')!==hash)throw Error('Public image verification failed');
  d1('UPDATE characters SET avatar_image_id='+quote(record.id)+' WHERE id='+quote(row.id)+' AND owner='+quote(row.owner)+' AND avatar_key='+quote(row.avatar_key)+' AND avatar_image_id IS NULL');
  const [verified]=d1('SELECT avatar_image_id FROM characters WHERE id='+quote(row.id));if(verified?.avatar_image_id!==record.id)continue;
  wrangler(['r2','object','delete','tavern/'+encodeURIComponent(row.avatar_key),'--remote']);
  d1('UPDATE characters SET avatar_key=NULL,avatar_type=NULL WHERE id='+quote(row.id)+' AND owner='+quote(row.owner)+' AND avatar_key='+quote(row.avatar_key)+' AND avatar_image_id='+quote(record.id));migrated++;
 }
 console.log(JSON.stringify({migrated,pending:d1('SELECT id FROM characters WHERE avatar_key IS NOT NULL').length}));
}catch{console.error('Tavern image migration stopped; completed references are retained for rerun.');process.exitCode=1;}finally{await db.end();rmSync(directory,{recursive:true,force:true});}

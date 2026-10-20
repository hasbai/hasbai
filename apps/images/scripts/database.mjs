import {readFileSync,writeFileSync} from 'node:fs';
import {Client} from 'pg';
import {randomBytes} from 'node:crypto';
const file=process.argv[2];if(!file)throw Error('Pass an ignored environment file.');
process.loadEnvFile(file);
const client=new Client({connectionString:process.env.DATABASE_URL});
try{
 await client.connect();
 await client.query(readFileSync(new URL('../../../database/images/0001_image_service.sql',import.meta.url),'utf8'));
 const password=randomBytes(36).toString('hex');
 await client.query("ALTER ROLE images_service LOGIN PASSWORD '"+password+"'");
 const url=new URL(process.env.DATABASE_URL);url.username='images_service';url.password=password;
 const vars='DATABASE_URL='+url.href+'\n'+(process.env.AIG_RP_RUN_TOKEN?'AIG_IMAGE_RUN_TOKEN='+process.env.AIG_RP_RUN_TOKEN+'\n':'');
 writeFileSync(file,vars,{mode:0o600});
 const service=new Client({connectionString:url.href});try{await service.connect();const r=await service.query('SELECT count(*)::int AS images FROM public.image');let denied=false;try{await service.query('SELECT * FROM public.content LIMIT 0');}catch{denied=true;}if(!denied)throw Error('Service role must not read blog content');console.log(JSON.stringify({imageCount:r.rows[0].images,contentAccessDenied:denied}));}finally{await service.end();}
}catch{console.error('Image database setup failed; credentials suppressed.');process.exitCode=1;}finally{await client.end();}

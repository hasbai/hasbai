import { Client } from 'pg';
export type ImageRow = { id:string; name:string; sha256:string; content_type:string; size:number; ready:boolean; owner:string|null; source:string; model:string|null; created_at:string; deleted_at:string|null };
export async function query<T extends Record<string, unknown>>(env:Pick<Env,'DATABASE_URL'>,text:string,values:unknown[]=[]):Promise<T[]> {
 const client = new Client({ connectionString:env.DATABASE_URL, connectionTimeoutMillis:10_000, query_timeout:15_000 });
 try { await client.connect(); return (await client.query<T>(text,values)).rows; }
 finally { await client.end(); }
}

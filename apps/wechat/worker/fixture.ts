import { DatabaseSync } from 'node:sqlite';
import { vi } from 'vitest';
import { WechatOwner } from './owner-object';

/** In-memory stand-in for a SQLite Durable Object; `sqlite` survives re-creating the object (eviction). */
export function createOwner(sqlite = new DatabaseSync(':memory:'), alarmState: { at: number | null } = { at: null }) {
  const storage = {
    sql: { exec: (query: string, ...values: unknown[]) => {
      if (query.trim().split(';').filter(Boolean).length > 1) { sqlite.exec(query); return { toArray: () => [] }; }
      const statement = sqlite.prepare(query);
      return { toArray: () => /^\s*(select|with)/i.test(query) ? statement.all(...values as never[]) : (statement.run(...values as never[]), []) };
    } },
    transactionSync: <T>(fn: () => T) => { sqlite.exec('BEGIN'); try { const r = fn(); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } },
    setAlarm: vi.fn(async (t: number) => { alarmState.at = t; }),
    getAlarm: vi.fn(async () => alarmState.at),
    deleteAlarm: vi.fn(async () => { alarmState.at = null; }),
  };
  const env = { ILINK_BASE_URL: 'https://ilinkai.weixin.qq.com', ILINK_CLIENT_VERSION: '2.4.8', ILINK_BOT_AGENT: 'Hasbai' } as unknown as Env;
  const owner = new WechatOwner({ storage } as unknown as DurableObjectState, env);
  return { owner, sqlite, alarmState };
}

export const json = (value: unknown, init?: ResponseInit) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' }, ...init });

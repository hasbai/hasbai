import { DatabaseSync } from 'node:sqlite';

export type TestStorageHooks = {
 kv?: Map<string, unknown>;
 alarms?: Map<string, number>;
 beforeExec?: (sql: string, values: unknown[]) => void;
 onDeleteAll?: (name: string) => Promise<void> | void;
 waitUntil?: (p: Promise<unknown>) => void;
};

type SqlCursor = {
 next(): { done: false; value: Record<string, unknown> } | { done: true; value: undefined };
 toArray(): Record<string, unknown>[];
 [Symbol.iterator](): Iterator<Record<string, unknown>>;
};

function makeCursor(rows: Record<string, unknown>[]): SqlCursor {
 let idx = 0;
 return {
  next() {
   if (idx < rows.length) return { done: false, value: rows[idx++] };
   return { done: true, value: undefined };
  },
  toArray() {
   return rows;
  },
  [Symbol.iterator]() {
   return rows.values();
  },
 };
}

function toNodeBind(value: unknown): unknown {
 if (value instanceof ArrayBuffer) return new Uint8Array(value);
 return value;
}

function fromNodeRow(row: Record<string, unknown>): Record<string, unknown> {
 for (const key of Object.keys(row)) {
  const val = row[key];
  if (val instanceof Uint8Array) row[key] = val.slice().buffer;
 }
 return row;
}

function hasMultipleStatements(query: string): boolean {
 const trimmed = query.trim();
 const first = trimmed.indexOf(';');
 return first !== -1 && first < trimmed.length - 1;
}

export function createTestStorage(sqlite: DatabaseSync, name: string, hooks: TestStorageHooks = {}): DurableObjectStorage {
 const kv = hooks.kv ?? new Map<string, unknown>();
 const alarms = hooks.alarms ?? new Map<string, number>();
 let txDepth = 0;

 const begin = () => {
  if (txDepth === 0) sqlite.exec('BEGIN');
  else sqlite.exec(`SAVEPOINT sp_${txDepth}`);
  txDepth++;
 };
 const commit = () => {
  txDepth--;
  if (txDepth === 0) sqlite.exec('COMMIT');
  else sqlite.exec(`RELEASE SAVEPOINT sp_${txDepth}`);
 };
 const rollback = () => {
  txDepth--;
  if (txDepth === 0) sqlite.exec('ROLLBACK');
  else sqlite.exec(`ROLLBACK TO SAVEPOINT sp_${txDepth}`);
 };

 return {
  sql: {
   exec(query: string, ...values: unknown[]) {
    hooks.beforeExec?.(query, values);
    if (values.length === 0 && hasMultipleStatements(query)) {
     sqlite.exec(query);
     return makeCursor([]);
    }
    const bound = values.map(toNodeBind);
    const rows = sqlite.prepare(query).all(...(bound as never[])).map((r) => fromNodeRow({ ...(r as Record<string, unknown>) }));
    return makeCursor(rows);
   },
  },
  kv: {
   get(key: string) {
    return kv.get(key);
   },
   put(key: string, value: unknown) {
    kv.set(key, structuredClone(value));
   },
   delete(key: string) {
    return kv.delete(key);
   },
   list(options?: { prefix?: string }) {
    const entries: [string, unknown][] = [];
    for (const [k, v] of kv.entries()) {
     if (!options?.prefix || k.startsWith(options.prefix)) entries.push([k, structuredClone(v)]);
    }
    return entries.sort(([a], [b]) => a.localeCompare(b))[Symbol.iterator]();
   },
  },
  transactionSync<T>(fn: () => T): T {
   begin();
   try {
    const result = fn();
    commit();
    return result;
   } catch (error) {
    rollback();
    throw error;
   }
  },
  async transaction<T>(fn: (txn: DurableObjectTransaction) => Promise<T>): Promise<T> {
   begin();
   try {
    const result = await fn(this as unknown as DurableObjectTransaction);
    commit();
    return result;
   } catch (error) {
    rollback();
    throw error;
   }
  },
  async getAlarm() {
   return alarms.get(name) ?? null;
  },
  async setAlarm(time: number | Date) {
   alarms.set(name, typeof time === 'number' ? time : time.getTime());
  },
  async deleteAlarm() {
   alarms.delete(name);
  },
  async deleteAll() {
   await hooks.onDeleteAll?.(name);
   for (const row of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    sqlite.exec('DROP TABLE "' + String((row as { name: string }).name) + '"');
   }
   kv.clear();
   alarms.delete(name);
  },
 } as unknown as DurableObjectStorage;
}

export function createTestDurableObjectState(
 sqlite: DatabaseSync,
 name: string,
 hooks: TestStorageHooks = {},
): DurableObjectState {
 const storage = createTestStorage(sqlite, name, hooks);
 return {
  id: {
   name,
   toString: () => name,
   equals: (other: { toString?: () => string }) => other?.toString?.() === name,
  },
  storage,
  waitUntil(promise: Promise<unknown>) {
   hooks.waitUntil?.(promise);
  },
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
   return callback();
  },
  abort(reason?: string) {
   throw new Error(reason ?? 'DurableObject aborted');
  },
  acceptWebSocket() {},
  getWebSockets() {
   return [];
  },
 } as unknown as DurableObjectState;
}

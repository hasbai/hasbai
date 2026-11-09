import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
import { createOwner, json } from './fixture';

const calls: { url: string; init: any }[] = [];
let handler: (url: URL, init: any) => Response | Promise<Response>;
beforeEach(() => {
  calls.length = 0;
  handler = () => json({ ret: 0 });
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: any) => { calls.push({ url: String(url), init }); return handler(new URL(url), init); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function login(o: ReturnType<typeof createOwner>['owner'], bot = 'bot@im.bot', token = 'secret-token') {
  handler = url => url.pathname.includes('get_bot_qrcode') ? json({ qrcode: 'qr1', qrcode_img_content: 'weixin://qr' })
    : url.pathname.includes('get_qrcode_status') ? json({ status: 'confirmed', bot_token: token, ilink_bot_id: bot, ilink_user_id: 'owner@im.wechat', baseurl: 'https://ilinkai.weixin.qq.com' })
    : json({ ret: 0 });
  const start: any = await o.loginStart();
  return await o.loginPoll(start.login_id) as any;
}
const message = (over: Record<string, unknown> = {}) => ({ message_id: '9007199254740993123', seq: '12', from_user_id: 'u1@im.wechat', message_type: 1, create_time_ms: 1000, context_token: 'ctx1', item_list: [{ type: 1, text_item: { text: '你好' } }], ...over });
const updates = (msgs: unknown[], cursor = 'c1') => `{"ret":0,"msgs":${JSON.stringify(msgs).replace('"9007199254740993123"', '9007199254740993123')},"get_updates_buf":"${cursor}","longpolling_timeout_ms":30000}`;
const pollWith = (body: string | (() => Response)) => { handler = url => url.pathname.endsWith('getupdates') ? (typeof body === 'string' ? new Response(body) : body()) : json({ ret: 0 }); };

it('logs in by QR, stores the account durably and never exposes credentials', async () => {
  const { owner, alarmState } = createOwner();
  handler = () => json({ qrcode: 'qr1', qrcode_img_content: 'weixin://qr' });
  const started: any = await owner.loginStart();
  expect(started).toMatchObject({ ok: true, qrcode_content: 'weixin://qr' });
  const qrCall = calls[0];
  expect(qrCall.init.headers.Authorization).toBeUndefined();
  expect(JSON.parse(qrCall.init.body)).toEqual({ local_token_list: [] });
  const confirmed = await login(owner);
  expect(confirmed).toMatchObject({ ok: true, status: 'confirmed', account: { account_id: 'bot@im.bot', enabled: true, state: 'active' } });
  expect(JSON.stringify(confirmed)).not.toContain('secret-token');
  expect(alarmState.at).not.toBeNull();
  const statusCall = calls.find(c => c.url.includes('get_qrcode_status'))!;
  expect(Object.keys(statusCall.init.headers).sort()).toEqual(['iLink-App-ClientVersion', 'iLink-App-Id']);
  expect(JSON.stringify(await owner.listAccounts())).not.toContain('secret-token');
});

it('polls with the saved cursor, dedupes replays and keeps 64-bit IDs exact', async () => {
  const { owner, sqlite } = createOwner();
  await login(owner);
  pollWith(updates([message()]));
  await owner.alarm();
  const first = JSON.parse(calls.find(c => c.url.endsWith('getupdates'))!.init.body);
  expect(first.get_updates_buf).toBe('');
  expect(sqlite.prepare('SELECT cursor FROM accounts').get()).toEqual({ cursor: 'c1' });
  expect(sqlite.prepare('SELECT wx_message_id FROM messages').all()).toEqual([{ wx_message_id: '9007199254740993123' }]);
  pollWith(updates([message()], 'c2'));
  sqlite.prepare('UPDATE accounts SET next_poll_at=0').run();
  await owner.alarm();
  const second = JSON.parse(calls.filter(c => c.url.endsWith('getupdates')).at(-1)!.init.body);
  expect(second.get_updates_buf).toBe('c1');
  expect(sqlite.prepare('SELECT count(*) n FROM messages').get()).toEqual({ n: 1 });
  const read: any = await owner.readMessages('bot@im.bot', undefined, 0, 10);
  expect(read.messages).toHaveLength(1);
  expect(read.messages[0]).toMatchObject({ direction: 'in', text: '你好', conversation_id: 'u1@im.wechat', status: 'received' });
  expect(read.next_after_id).toBe(read.messages[0].id);
});

it('keeps the old cursor on an empty cursor and treats a client timeout as an empty result', async () => {
  const { owner, sqlite } = createOwner();
  await login(owner);
  pollWith(updates([message()]));
  await owner.alarm();
  pollWith(`{"ret":0,"msgs":[],"get_updates_buf":""}`);
  sqlite.prepare('UPDATE accounts SET next_poll_at=0').run();
  await owner.alarm();
  expect(sqlite.prepare('SELECT cursor FROM accounts').get()).toEqual({ cursor: 'c1' });
  pollWith(() => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); });
  sqlite.prepare('UPDATE accounts SET next_poll_at=0').run();
  await owner.alarm();
  expect(sqlite.prepare('SELECT failures,cursor FROM accounts').get()).toEqual({ failures: 0, cursor: 'c1' });
});

it('survives eviction: a new object over the same storage resumes from the persisted cursor', async () => {
  const first = createOwner();
  await login(first.owner);
  pollWith(updates([message()]));
  await first.owner.alarm();
  const resumed = createOwner(first.sqlite, first.alarmState);
  pollWith(updates([], 'c9'));
  first.sqlite.prepare('UPDATE accounts SET next_poll_at=0').run();
  await resumed.owner.alarm();
  expect(JSON.parse(calls.filter(c => c.url.endsWith('getupdates')).at(-1)!.init.body).get_updates_buf).toBe('c1');
  expect(((await resumed.owner.listAccounts()) as any).accounts[0]).toMatchObject({ account_id: 'bot@im.bot', has_cursor: true });
});

it('pauses for an hour on -14 and asks for re-login after a repeat', async () => {
  const { owner, sqlite } = createOwner();
  await login(owner);
  pollWith('{"ret":-14,"errmsg":"expired"}');
  await owner.alarm();
  let row: any = sqlite.prepare('SELECT * FROM accounts').get();
  expect(row.state).toBe('expired');
  expect(row.paused_until - Date.now()).toBeGreaterThan(3500_000);
  expect(row.expired_streak).toBe(1);
  sqlite.prepare('UPDATE accounts SET paused_until=0,next_poll_at=0').run();
  pollWith('{"errcode":-14}');
  await owner.alarm();
  expect(((await owner.accountStatus('bot@im.bot')) as any).account).toMatchObject({ state: 'expired', needs_relogin: true });
});

it('backs off exponentially on failures and recovers on success', async () => {
  const { owner, sqlite } = createOwner();
  await login(owner);
  pollWith(() => new Response('x', { status: 502 }));
  await owner.alarm();
  let row: any = sqlite.prepare('SELECT * FROM accounts').get();
  expect(row.failures).toBe(1);
  expect(row.next_poll_at - Date.now()).toBeGreaterThan(1000);
  expect(row.last_error).toBe('HTTP 502');
  sqlite.prepare('UPDATE accounts SET next_poll_at=0').run();
  pollWith(updates([]));
  await owner.alarm();
  row = sqlite.prepare('SELECT * FROM accounts').get();
  expect(row).toMatchObject({ failures: 0, last_error: null });
});

it('discards a poll result that returns after logout or re-login', async () => {
  const { owner, sqlite } = createOwner();
  await login(owner);
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  handler = url => url.pathname.endsWith('getupdates') ? (undefined as any) : json({ ret: 0 });
  (fetch as any).mockImplementation(async (url: URL) => {
    calls.push({ url: String(url), init: {} });
    if (String(url).endsWith('getupdates')) { await gate; return new Response(updates([message()])); }
    return json({ ret: 0 });
  });
  const running = owner.alarm();
  await Promise.resolve();
  await owner.logout('bot@im.bot');
  release();
  await running;
  expect(sqlite.prepare('SELECT count(*) n FROM messages').get()).toEqual({ n: 0 });
  expect(sqlite.prepare('SELECT count(*) n FROM accounts').get()).toEqual({ n: 0 });
});

it('replies with the newest context token, dedupes by client_id and never resends an unknown outcome', async () => {
  const { owner, sqlite } = createOwner();
  await login(owner);
  pollWith(updates([message({ message_id: '1', create_time_ms: 2000, context_token: 'new' }), message({ message_id: '2', create_time_ms: 1000, context_token: 'old' })]));
  await owner.alarm();
  const id = crypto.randomUUID();
  handler = () => json({ ret: 0 });
  const sent: any = await owner.sendText('bot@im.bot', 'u1@im.wechat', '收到', id);
  expect(sent).toMatchObject({ ok: true, status: 'sent' });
  const body = JSON.parse(calls.filter(c => c.url.endsWith('sendmessage')).at(-1)!.init.body);
  expect(body.msg).toMatchObject({ to_user_id: 'u1@im.wechat', context_token: 'new', message_type: 2, message_state: 2, client_id: id, item_list: [{ type: 1, text_item: { text: '收到' } }] });
  const before = calls.length;
  expect(await owner.sendText('bot@im.bot', 'u1@im.wechat', '收到', id)).toMatchObject({ ok: true, deduplicated: true, status: 'sent' });
  expect(calls.length).toBe(before);
  handler = () => { throw new TypeError('network'); };
  const unknown: any = await owner.sendText('bot@im.bot', 'u1@im.wechat', '再见', crypto.randomUUID());
  expect(unknown).toMatchObject({ ok: false });
  expect(unknown.error).toContain('不要重复发送');
  expect(sqlite.prepare("SELECT status FROM messages WHERE direction='out' ORDER BY id DESC").get()).toEqual({ status: 'unknown' });
  handler = () => json({ ret: 5, errmsg: 'bad token' });
  expect(await owner.sendText('bot@im.bot', 'u1@im.wechat', 'x', crypto.randomUUID())).toMatchObject({ ok: false });
  expect(((await owner.listConversations('bot@im.bot', 10)) as any).conversations[0].can_reply).toBe(false);
});

it('refuses groups, unknown conversations and contacts without a reply token', async () => {
  const { owner } = createOwner();
  await login(owner);
  pollWith(updates([message({ message_id: 'g1', group_id: 'g@chatroom' }), message({ message_id: 'n1', from_user_id: 'u2', context_token: undefined })]));
  await owner.alarm();
  expect(await owner.sendText('bot@im.bot', 'g@chatroom', 'x', crypto.randomUUID())).toMatchObject({ ok: false });
  expect(await owner.sendText('bot@im.bot', 'u2', 'x', crypto.randomUUID())).toMatchObject({ ok: false });
  expect(await owner.sendText('bot@im.bot', 'nobody', 'x', crypto.randomUUID())).toMatchObject({ ok: false });
  expect(calls.some(c => c.url.endsWith('sendmessage'))).toBe(false);
});

it('pauses, resumes and removes an account together with its data and alarm', async () => {
  const { owner, sqlite, alarmState } = createOwner();
  await login(owner);
  pollWith(updates([message()]));
  await owner.alarm();
  expect(await owner.setPolling('bot@im.bot', false)).toMatchObject({ ok: true, account: { enabled: false } });
  expect(alarmState.at).toBeNull();
  expect(await owner.setPolling('bot@im.bot', true)).toMatchObject({ ok: true, account: { enabled: true } });
  expect(alarmState.at).not.toBeNull();
  expect(await owner.logout('bot@im.bot')).toMatchObject({ ok: true, deleted: true });
  for (const table of ['accounts', 'peers', 'messages']) expect(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({ n: 0 });
  expect(alarmState.at).toBeNull();
  expect(await owner.accountStatus('bot@im.bot')).toEqual({ ok: false, error: '账号不存在' });
});

it('does not trust a non-Tencent redirect or API host from the server', async () => {
  const { owner, sqlite } = createOwner();
  const qr = () => { handler = () => json({ qrcode: 'q', qrcode_img_content: 'c' }); };
  qr();
  const start: any = await owner.loginStart();
  handler = () => json({ status: 'confirmed', bot_token: 't', ilink_bot_id: 'b', baseurl: 'https://evil.example.com' });
  await owner.loginPoll(start.login_id);
  expect(sqlite.prepare('SELECT base_url FROM accounts').get()).toEqual({ base_url: 'https://ilinkai.weixin.qq.com' });
  qr();
  const second: any = await owner.loginStart();
  handler = () => json({ status: 'scaned_but_redirect', redirect_host: 'evil.example.com' });
  await owner.loginPoll(second.login_id);
  expect(sqlite.prepare('SELECT host FROM logins WHERE login_id=?').get(second.login_id)).toEqual({ host: 'https://ilinkai.weixin.qq.com' });
});

it('strips media keys from stored items', async () => {
  const { owner, sqlite } = createOwner();
  await login(owner);
  pollWith(updates([message({ item_list: [{ type: 2, image_item: { aeskey: 'k', media: { encrypt_query_param: 'p', aes_key: 'k' }, mid_size: 5 } }] })]));
  await owner.alarm();
  const row: any = sqlite.prepare('SELECT text,items_json FROM messages').get();
  expect(row.text).toBe('[图片]');
  expect(row.items_json).not.toMatch(/aeskey|aes_key|encrypt_query_param/);
});

it('keeps polling other accounts and backs off instead of spinning when one account hits a storage error', async () => {
  const { owner, sqlite } = createOwner();
  await login(owner, 'bad@im.bot', 't1');
  await login(owner, 'good@im.bot', 't2');
  sqlite.exec(`CREATE TRIGGER boom BEFORE INSERT ON messages WHEN NEW.bot_id='bad@im.bot' BEGIN SELECT RAISE(ABORT,'disk'); END`);
  pollWith(updates([message()]));
  await owner.alarm();
  const rows: any[] = sqlite.prepare('SELECT bot_id,failures,cursor FROM accounts ORDER BY bot_id').all();
  expect(rows.find(r => r.bot_id === 'bad@im.bot')).toMatchObject({ failures: 1, cursor: '' });
  expect(rows.find(r => r.bot_id === 'good@im.bot')).toMatchObject({ failures: 0, cursor: 'c1' });
});

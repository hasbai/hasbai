import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
vi.mock('@hasbai/auth/server', () => ({ verifyUserToken: vi.fn() }));
import { verifyUserToken } from '@hasbai/auth/server';
import worker from './index';
import { createOwner, json } from './fixture';

const owners = new Map<string, ReturnType<typeof createOwner>>();
const names: string[] = [];
const env = {
  VERSION: { id: 'v1' },
  OWNERS: { getByName: (name: string) => { names.push(name); if (!owners.has(name)) owners.set(name, createOwner()); return owners.get(name)!.owner; } },
} as unknown as Env;

function rpc(method: string, params: unknown, token: string | null = 't', path = '/mcp') {
  return worker.fetch(new Request('https://wechat.hasbai.xyz' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), env);
}
const call = async (name: string, args: unknown, token = 't') => (await (await rpc('tools/call', { name, arguments: args }, token)).json() as any).result;

beforeEach(() => {
  owners.clear(); names.length = 0;
  vi.mocked(verifyUserToken).mockResolvedValue({ sub: 'auth0|admin', permissions: ['wechat.all:all'] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('serves health anonymously and hides every other path', async () => {
  const health = await worker.fetch(new Request('https://wechat.hasbai.xyz/health'), env);
  expect(await health.json()).toEqual({ ok: true, service: 'wechat', version: 'v1' });
  expect((await rpc('tools/list', {}, 't', '/other')).status).toBe(404);
});

it('requires a verified user token with the native wechat permission', async () => {
  expect((await rpc('tools/list', {}, null)).status).toBe(401);
  vi.mocked(verifyUserToken).mockRejectedValue(Error('bad signature'));
  expect((await rpc('tools/list', {})).status).toBe(401);
  vi.mocked(verifyUserToken).mockResolvedValue({ sub: 'auth0|user', role: 'superadmin', _roles: ['superadmin'] });
  expect((await rpc('tools/list', {})).status).toBe(403);
  vi.mocked(verifyUserToken).mockResolvedValue({ permissions: ['wechat.all:all'] });
  expect((await rpc('tools/list', {})).status).toBe(401);
  expect(names).toEqual([]);
});

it('lists the tools with read-only and destructive annotations', async () => {
  const body = await (await rpc('tools/list', {})).json() as any;
  const tools = Object.fromEntries(body.result.tools.map((t: any) => [t.name, t.annotations]));
  expect(Object.keys(tools).sort()).toEqual([
    'wechat_account_status', 'wechat_list_accounts', 'wechat_list_conversations', 'wechat_login_poll', 'wechat_login_start',
    'wechat_logout', 'wechat_read_messages', 'wechat_send_text', 'wechat_set_polling',
  ]);
  expect(tools.wechat_list_accounts.readOnlyHint).toBe(true);
  expect(tools.wechat_logout.destructiveHint).toBe(true);
  expect(tools.wechat_send_text.readOnlyHint).toBe(false);
});

it('isolates each Auth0 subject in its own owner object and runs tools end to end', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => String(url).includes('get_bot_qrcode') ? json({ qrcode: 'q', qrcode_img_content: 'weixin://x' })
    : String(url).includes('get_qrcode_status') ? json({ status: 'confirmed', bot_token: 'secret', ilink_bot_id: 'bot1' }) : json({ ret: 0 })));
  const started = await call('wechat_login_start', {});
  expect(started.structuredContent).toEqual({ login_id: expect.any(String), qrcode_content: 'weixin://x' });
  const confirmed = await call('wechat_login_poll', { login_id: started.structuredContent.login_id });
  expect(confirmed.structuredContent.status).toBe('confirmed');
  expect(JSON.stringify(confirmed)).not.toContain('secret');
  expect((await call('wechat_list_accounts', {})).structuredContent.accounts).toHaveLength(1);

  vi.mocked(verifyUserToken).mockResolvedValue({ sub: 'auth0|other', permissions: ['wechat.all:all'] });
  expect((await call('wechat_list_accounts', {})).structuredContent.accounts).toEqual([]);
  expect(await call('wechat_account_status', { account_id: 'bot1' })).toMatchObject({ isError: true });
  expect(new Set(names)).toEqual(new Set(['auth0|admin', 'auth0|other']));
});

it('validates inputs and requires matching confirmation before deleting', async () => {
  const bad = await (await rpc('tools/call', { name: 'wechat_send_text', arguments: { account_id: 'a', conversation_id: 'c', text: '' } })).json() as any;
  expect(bad.result?.isError ?? !!bad.error).toBe(true);
  expect(await call('wechat_logout', { account_id: 'a', confirm_account_id: 'b' })).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('不一致') }] });
});

import { afterEach, expect, it, vi } from 'vitest';
import { encodeClientVersion, getUpdates, inboundMessage, parseIlink, qrStatus, trustedBase } from '@hasbai/messaging/wechat';

const cfg = { baseUrl: 'https://ilinkai.weixin.qq.com', clientVersion: '2.4.8', botAgent: 'Hasbai', routeTag: 'tag' };
afterEach(() => vi.unstubAllGlobals());

it('encodes the client version as 0x00MMNNPP', () => {
  expect(encodeClientVersion('2.4.8')).toBe(String(0x00020408));
  expect(() => encodeClientVersion('2.4')).toThrow();
  expect(() => encodeClientVersion('1.256.0')).toThrow();
});

it('accepts only https Tencent hosts for server-supplied addresses', () => {
  expect(trustedBase('https://ilinkai.weixin.qq.com')).toBe('https://ilinkai.weixin.qq.com');
  expect(trustedBase('shortlink.weixin.qq.com')).toBe('https://shortlink.weixin.qq.com');
  for (const bad of ['http://a.weixin.qq.com', 'https://weixin.qq.com.evil.com', 'https://evilweixin.qq.com', 'https://user:p@a.weixin.qq.com', 'https://a.weixin.qq.com:8443', 'javascript:alert(1)', '', undefined, 5]) expect(trustedBase(bad)).toBeUndefined();
});

it('keeps 64-bit ids exact and rejects non-object bodies', () => {
  expect(parseIlink('{"msgs":[{"message_id":9007199254740993123,"seq":9007199254740993}]}').msgs[0]).toEqual({ message_id: '9007199254740993123', seq: '9007199254740993' });
  expect(() => parseIlink('[]')).toThrow();
  expect(() => parseIlink('<html>')).toThrow();
});

it('does not rewrite id-looking text inside message content', () => {
  const text = JSON.stringify({ msgs: [{ item_list: [{ type: 1, text_item: { text: '"message_id":12345678901234567' } }] }] });
  expect(parseIlink(text).msgs[0].item_list[0].text_item.text).toBe('"message_id":12345678901234567');
});

it('sends bot requests with the documented headers and base_info', async () => {
  const fetchMock = vi.fn(async () => new Response('{"ret":0,"msgs":[],"get_updates_buf":"n"}'));
  vi.stubGlobal('fetch', fetchMock);
  await getUpdates(cfg, 'tok', cfg.baseUrl, 'cur');
  const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit & { headers: Record<string, string> }];
  expect(String(url)).toBe('https://ilinkai.weixin.qq.com/ilink/bot/getupdates');
  expect(init.redirect).toBe('manual');
  expect(init.headers).toMatchObject({ AuthorizationType: 'ilink_bot_token', Authorization: 'Bearer tok', 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': '132104', SKRouteTag: 'tag' });
  expect(Number(atob(init.headers['X-WECHAT-UIN']))).toBeGreaterThanOrEqual(0);
  expect(JSON.parse(init.body as string)).toEqual({ get_updates_buf: 'cur', base_info: { channel_version: '2.4.8', bot_agent: 'Hasbai' } });
});

it('turns a failed QR status request into wait', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
  expect(await qrStatus(cfg, cfg.baseUrl, 'q')).toEqual({ status: 'wait' });
});

it('ignores bot echoes and messages without a sender; voice uses its transcript', () => {
  expect(inboundMessage({ message_type: 2, from_user_id: 'bot' })).toBeUndefined();
  expect(inboundMessage({ message_type: 1 })).toBeUndefined();
  expect(inboundMessage({ message_type: 1, from_user_id: 'u', item_list: [{ type: 3, voice_item: { text: '语音转写' } }] })?.text).toBe('语音转写');
});

it('drops over-deep subtrees, handles zero ids and leaves fractional large numbers parseable', () => {
  const deep = { type: 1, a: { b: { c: { d: { e: { f: { g: { aes_key: 'k' } } } } } } } };
  expect(JSON.stringify(inboundMessage({ message_type: 1, from_user_id: 'u', item_list: [deep] })?.items)).not.toContain('aes_key');
  const a = inboundMessage({ message_type: 1, from_user_id: 'u', message_id: 0, seq: 3, create_time_ms: 5 })!;
  const b = inboundMessage({ message_type: 1, from_user_id: 'u', message_id: '0', seq: 4, create_time_ms: 6 })!;
  expect(a.id).not.toBe(b.id);
  expect(inboundMessage({ message_type: 1, from_user_id: 'u', message_id: 0, seq: 3, create_time_ms: 5 })!.id).toBe(a.id);
  expect(parseIlink('{"seq":1234567890123456.5}').seq).toBe(1234567890123456.5);
});

/**
 * iLink (openclaw-weixin) transport only: no storage, accounts or session logic.
 * Protocol: https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md
 * That page describes client behaviour, not a verified server contract; fields are read defensively.
 */
export type IlinkConfig = { baseUrl: string; clientVersion: string; botAgent: string; routeTag?: string };

export class IlinkError extends Error {
  /** `rejected`: server answered with a business error. `network`: outcome unknown. */
  constructor(
    readonly kind: 'network' | 'http' | 'rejected' | 'protocol',
    readonly code?: number,
    message = 'iLink 请求失败',
  ) {
    super(message);
  }
}

export const SESSION_EXPIRED = -14;

/** Only Tencent hosts may receive a bot token; server-supplied hosts are never trusted blindly. */
export function trustedBase(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return;
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); } catch { return; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return;
  if (host !== 'weixin.qq.com' && !host.endsWith('.weixin.qq.com')) return;
  return url.origin;
}

/** 0x00MMNNPP as a decimal string. */
export function encodeClientVersion(version: string): string {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new IlinkError('protocol', undefined, '客户端版本无效');
  return String(((parts[0] << 16) | (parts[1] << 8) | parts[2]) >>> 0);
}

const uin = () => btoa(String(crypto.getRandomValues(new Uint32Array(1))[0]));

function headers(cfg: IlinkConfig, kind: 'status' | 'public' | 'bot', token?: string): Record<string, string> {
  const result: Record<string, string> = { 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': encodeClientVersion(cfg.clientVersion) };
  if (cfg.routeTag) result.SKRouteTag = cfg.routeTag;
  if (kind === 'status') return result;
  result['Content-Type'] = 'application/json';
  result.AuthorizationType = 'ilink_bot_token';
  result['X-WECHAT-UIN'] = uin();
  if (kind === 'bot' && token) result.Authorization = `Bearer ${token}`;
  return result;
}

/** Snowflake-like IDs exceed 2^53; keep them exact by quoting them before parsing. */
const ID_FIELDS = /"(message_id|seq|msg_id|run_id|session_id|group_id)"\s*:\s*(-?\d{15,})(?![.eE\d])/g;
export function parseIlink(text: string): Record<string, any> {
  try {
    const value = JSON.parse(text.replace(ID_FIELDS, '"$1":"$2"'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* fall through */ }
  throw new IlinkError('protocol', undefined, 'iLink 响应格式无效');
}

async function call(url: URL, init: RequestInit): Promise<Record<string, any>> {
  let response: Response;
  try { response = await fetch(url, { ...init, redirect: 'manual' }); } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw error;
    throw new IlinkError('network');
  }
  if (!response.ok) throw new IlinkError('http', response.status, `iLink HTTP ${response.status}`);
  return parseIlink(await response.text());
}

const safeMessage = (value: unknown) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200) : undefined;
const baseInfo = (cfg: IlinkConfig) => ({ channel_version: cfg.clientVersion, bot_agent: cfg.botAgent });
const isTimeout = (error: unknown) => error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

/* ---------- QR login ---------- */

export async function qrStart(cfg: IlinkConfig): Promise<{ qrcode: string; content: string }> {
  const data = await call(new URL('/ilink/bot/get_bot_qrcode?bot_type=3', cfg.baseUrl), {
    method: 'POST', headers: headers(cfg, 'public'), body: JSON.stringify({ local_token_list: [] }), signal: AbortSignal.timeout(15000),
  }).catch(error => { throw isTimeout(error) ? new IlinkError('network') : error; });
  if (typeof data.qrcode !== 'string' || !data.qrcode) throw new IlinkError('protocol', undefined, '未取得二维码');
  return { qrcode: data.qrcode, content: typeof data.qrcode_img_content === 'string' ? data.qrcode_img_content : '' };
}

export type QrStatus = {
  status: string; botToken?: string; botId?: string; userId?: string; baseUrl?: string; redirectBase?: string;
};
/** Request failures become `wait`, as the reference client does. */
export async function qrStatus(cfg: IlinkConfig, baseUrl: string, qrcode: string, verifyCode?: string): Promise<QrStatus> {
  const url = new URL('/ilink/bot/get_qrcode_status', baseUrl);
  url.searchParams.set('qrcode', qrcode);
  if (verifyCode) url.searchParams.set('verify_code', verifyCode);
  let data: Record<string, any>;
  try { data = await call(url, { method: 'GET', headers: headers(cfg, 'status'), signal: AbortSignal.timeout(30000) }); } catch { return { status: 'wait' }; }
  const str = (v: unknown) => typeof v === 'string' && v ? v : undefined;
  return {
    status: str(data.status) ?? 'wait', botToken: str(data.bot_token), botId: str(data.ilink_bot_id), userId: str(data.ilink_user_id),
    baseUrl: trustedBase(data.baseurl), redirectBase: trustedBase(data.redirect_host),
  };
}

/* ---------- Bot API ---------- */

export type InboundMessage = {
  id: string; seq?: string; from: string; group?: string; peer: string; text: string;
  createdMs: number; contextToken?: string; items: unknown[];
};
export type UpdatesResult = { ret: number; errcode: number; errmsg?: string; messages: InboundMessage[]; cursor: string; timeoutMs?: number; timedOut?: boolean };

const SECRET_KEYS = new Set(['aeskey', 'aes_key', 'encrypt_query_param', 'full_url', 'media', 'thumb_media', 'thumb_upload_param', 'upload_param']);
/** Media references carry CDN keys; keep only descriptive fields. */
export function stripSecrets(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return value.map(v => stripSecrets(v, depth + 1));
  if (depth > 6) return undefined;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !SECRET_KEYS.has(k)).map(([k, v]) => [k, stripSecrets(v, depth + 1)]));
}
const KIND: Record<number, string> = { 2: '图片', 3: '语音', 4: '文件', 5: '视频' };
export function messageText(items: any[]): string {
  return items.map(item => {
    if (item?.type === 1) return String(item.text_item?.text ?? '');
    if (item?.type === 3 && item.voice_item?.text) return String(item.voice_item.text);
    if (item?.type === 4 && item.file_item?.file_name) return `[文件] ${safeMessage(item.file_item.file_name)}`;
    return KIND[item?.type] ? `[${KIND[item.type]}]` : '';
  }).filter(Boolean).join('\n').slice(0, 8000);
}
export function inboundMessage(raw: any): InboundMessage | undefined {
  if (!raw || typeof raw !== 'object' || raw.message_type === 2) return;
  const from = typeof raw.from_user_id === 'string' ? raw.from_user_id : '';
  if (!from) return;
  const group = raw.group_id ? String(raw.group_id) : undefined;
  const items: any[] = Array.isArray(raw.item_list) ? raw.item_list : [];
  const stamp = Number.isFinite(Number(raw.create_time_ms)) && Number(raw.create_time_ms) > 0 ? Number(raw.create_time_ms) : 0;
  const createdMs = stamp || Date.now();
  const seq = raw.seq === undefined || raw.seq === null ? undefined : String(raw.seq);
  const given = raw.message_id === undefined || raw.message_id === null ? '' : String(raw.message_id);
  // A zero or empty ID would collide for every message; the fallback key is stable across replays.
  const id = given && !/^0*$/.test(given) ? given : `${seq ?? 'x'}:${stamp}:${from}:${raw.context_token ?? ''}`;
  return {
    id, seq, from, group, peer: group ?? from, text: messageText(items), createdMs,
    contextToken: typeof raw.context_token === 'string' && raw.context_token ? raw.context_token : undefined,
    items: stripSecrets(items) as unknown[],
  };
}

/** One long poll. A client-side timeout is a normal empty result. */
export async function getUpdates(cfg: IlinkConfig, token: string, baseUrl: string, cursor: string, pollTimeoutMs?: number): Promise<UpdatesResult> {
  const wait = Math.min(Math.max(pollTimeoutMs ?? 35000, 5000), 55000) + 5000;
  let data: Record<string, any>;
  try {
    data = await call(new URL('/ilink/bot/getupdates', baseUrl), {
      method: 'POST', headers: headers(cfg, 'bot', token), body: JSON.stringify({ get_updates_buf: cursor, base_info: baseInfo(cfg) }), signal: AbortSignal.timeout(wait),
    });
  } catch (error) {
    if (isTimeout(error)) return { ret: 0, errcode: 0, messages: [], cursor: '', timedOut: true };
    throw error;
  }
  const num = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const msgs: unknown[] = Array.isArray(data.msgs) ? data.msgs : [];
  return {
    ret: num(data.ret), errcode: num(data.errcode), errmsg: safeMessage(data.errmsg),
    messages: msgs.map(inboundMessage).filter((m): m is InboundMessage => !!m),
    cursor: typeof data.get_updates_buf === 'string' ? data.get_updates_buf : '',
    timeoutMs: Number.isFinite(Number(data.longpolling_timeout_ms)) && Number(data.longpolling_timeout_ms) > 0 ? Number(data.longpolling_timeout_ms) : undefined,
  };
}

export async function sendText(cfg: IlinkConfig, token: string, baseUrl: string, input: { to: string; text: string; contextToken: string; clientId: string }) {
  const data = await call(new URL('/ilink/bot/sendmessage', baseUrl), {
    method: 'POST', headers: headers(cfg, 'bot', token), signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      msg: {
        from_user_id: '', to_user_id: input.to, client_id: input.clientId, message_type: 2, message_state: 2,
        context_token: input.contextToken, item_list: [{ type: 1, text_item: { text: input.text } }],
      },
      base_info: baseInfo(cfg),
    }),
  }).catch(error => { throw isTimeout(error) ? new IlinkError('network') : error; });
  const ret = Number(data.ret ?? 0), errcode = Number(data.errcode ?? 0);
  if (ret || errcode) throw new IlinkError('rejected', ret || errcode, safeMessage(data.errmsg) ?? 'iLink 拒绝了消息');
}

/** Best effort: failures are never fatal. */
export async function notify(cfg: IlinkConfig, token: string, baseUrl: string, kind: 'start' | 'stop'): Promise<boolean> {
  try {
    await call(new URL(`/ilink/bot/msg/notify${kind}`, baseUrl), {
      method: 'POST', headers: headers(cfg, 'bot', token), body: JSON.stringify({ base_info: baseInfo(cfg) }), signal: AbortSignal.timeout(10000),
    });
    return true;
  } catch { return false; }
}

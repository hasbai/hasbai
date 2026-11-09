import { DurableObject } from 'cloudflare:workers';
import {
  IlinkError, SESSION_EXPIRED, getUpdates, notify, qrStart, qrStatus, sendText, type IlinkConfig, type UpdatesResult,
} from '@hasbai/messaging/wechat';

/**
 * One SQLite Durable Object per Auth0 user. It owns every WeChat bot of that user:
 * credentials, update cursor, per-contact reply tokens, message log and the alarm-driven poll loop.
 * Cursor and messages commit in one transaction; a single object means a single poller per bot.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts(
  bot_id TEXT PRIMARY KEY, ilink_user_id TEXT, base_url TEXT NOT NULL, token TEXT NOT NULL, cursor TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'active', expired_streak INTEGER NOT NULL DEFAULT 0,
  paused_until INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0, next_poll_at INTEGER NOT NULL DEFAULT 0,
  poll_timeout_ms INTEGER, last_poll_at INTEGER, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS logins(login_id TEXT PRIMARY KEY, qrcode TEXT NOT NULL, host TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS peers(
  bot_id TEXT NOT NULL, peer_id TEXT NOT NULL, kind TEXT NOT NULL, context_token TEXT, context_at INTEGER NOT NULL DEFAULT 0,
  context_status TEXT NOT NULL DEFAULT 'ok', last_message_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(bot_id, peer_id));
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL, peer_id TEXT NOT NULL, direction TEXT NOT NULL,
  wx_message_id TEXT, seq TEXT, from_user_id TEXT, text TEXT NOT NULL DEFAULT '', items_json TEXT,
  create_time_ms INTEGER NOT NULL, received_at INTEGER NOT NULL, client_id TEXT, status TEXT NOT NULL, error TEXT,
  UNIQUE(bot_id, wx_message_id), UNIQUE(bot_id, client_id));
CREATE INDEX IF NOT EXISTS messages_peer ON messages(bot_id, peer_id, id);
`;

export const LIMITS = { accounts: 10, retentionMs: 30 * 86400_000, retentionRows: 20000, loopMs: 45_000, watchdogMs: 90_000, expiredPauseMs: 3600_000 };

type Account = {
  bot_id: string; ilink_user_id: string | null; base_url: string; token: string; cursor: string; enabled: number; state: string;
  expired_streak: number; paused_until: number; failures: number; next_poll_at: number; poll_timeout_ms: number | null;
  last_poll_at: number | null; last_error: string | null;
};
type Peer = { bot_id: string; peer_id: string; kind: string; context_token: string | null; context_at: number; context_status: string; last_message_at: number };

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
/** The only errors whose text may reach the caller. */
class Fail extends Error {}
const fail = (message: string): never => { throw new Fail(message); };

export class WechatOwner extends DurableObject<Env> {
  private polling = new Set<string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(SCHEMA);
  }

  private rows<T>(query: string, ...bindings: unknown[]): T[] {
    return this.ctx.storage.sql.exec(query, ...bindings).toArray() as T[];
  }
  private run(query: string, ...bindings: unknown[]) { this.ctx.storage.sql.exec(query, ...bindings).toArray(); }
  private get cfg(): IlinkConfig {
    return { baseUrl: this.env.ILINK_BASE_URL, clientVersion: this.env.ILINK_CLIENT_VERSION, botAgent: this.env.ILINK_BOT_AGENT };
  }
  private account(botId: string): Account {
    return this.rows<Account>('SELECT * FROM accounts WHERE bot_id=?', botId)[0] ?? fail('账号不存在');
  }
  private async guard<T extends object>(work: () => Promise<T> | T): Promise<Result<T>> {
    try { return { ok: true, ...(await work()) }; } catch (error) {
      if (error instanceof Fail) return { ok: false, error: error.message };
      console.error('wechat owner error', error instanceof Error ? error.name : 'unknown');
      return { ok: false, error: '微信操作失败' };
    }
  }
  /** Never exposes the token, cursor or any context token. */
  private view(a: Account) {
    return {
      account_id: a.bot_id, ilink_user_id: a.ilink_user_id, enabled: !!a.enabled, state: a.state, paused_until: a.paused_until || null,
      last_poll_at: a.last_poll_at, last_error: a.last_error, failures: a.failures, has_cursor: !!a.cursor, needs_relogin: a.expired_streak >= 2,
    };
  }

  /* ---------- Login ---------- */

  loginStart() {
    return this.guard(async () => {
      this.run('DELETE FROM logins WHERE created_at<?', Date.now() - 600_000);
      const qr = await qrStart(this.cfg).catch(() => fail('获取二维码失败，请稍后重试'));
      const id = crypto.randomUUID();
      this.run('INSERT INTO logins(login_id,qrcode,host,created_at) VALUES(?,?,?,?)', id, qr.qrcode, this.cfg.baseUrl, Date.now());
      return { login_id: id, qrcode_content: qr.content };
    });
  }

  loginPoll(loginId: string, verifyCode?: string) {
    return this.guard(async () => {
      const login = this.rows<{ qrcode: string; host: string; created_at: number }>('SELECT * FROM logins WHERE login_id=?', loginId)[0];
      if (!login || login.created_at < Date.now() - 600_000) return fail('登录会话不存在或已过期，请重新获取二维码');
      const status = await qrStatus(this.cfg, login.host, login.qrcode, verifyCode);
      if (status.status === 'scaned_but_redirect' && status.redirectBase) this.run('UPDATE logins SET host=? WHERE login_id=?', status.redirectBase, loginId);
      if (status.status !== 'confirmed') {
        if (status.status === 'expired' || status.status === 'verify_code_blocked') this.run('DELETE FROM logins WHERE login_id=?', loginId);
        return { status: status.status };
      }
      if (!status.botToken || !status.botId) return fail('登录响应缺少 Bot 凭据');
      const known = this.rows('SELECT 1 FROM accounts WHERE bot_id=?', status.botId).length > 0;
      if (!known && this.rows('SELECT 1 FROM accounts').length >= LIMITS.accounts) return fail(`最多保存 ${LIMITS.accounts} 个微信账号`);
      const now = Date.now(), base = status.baseUrl ?? this.cfg.baseUrl;
      // Re-login replaces the token and restarts the cursor; unique message IDs absorb any replay.
      this.run(`INSERT INTO accounts(bot_id,ilink_user_id,base_url,token,created_at,updated_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(bot_id) DO UPDATE SET ilink_user_id=excluded.ilink_user_id,base_url=excluded.base_url,token=excluded.token,cursor='',
        enabled=1,state='active',expired_streak=0,paused_until=0,failures=0,next_poll_at=0,last_error=NULL,updated_at=excluded.updated_at`,
        status.botId, status.userId ?? null, base, status.botToken, now, now);
      this.run('DELETE FROM logins WHERE login_id=?', loginId);
      await notify(this.cfg, status.botToken, base, 'start');
      await this.rearm();
      return { status: 'confirmed', account: this.view(this.account(status.botId)) };
    });
  }

  /* ---------- Reads ---------- */

  listAccounts() {
    return this.guard(async () => {
      await this.ensureAlarm();
      return { accounts: this.rows<Account>('SELECT * FROM accounts ORDER BY created_at').map(a => this.view(a)) };
    });
  }

  accountStatus(botId: string) {
    return this.guard(async () => { await this.ensureAlarm(); return { account: this.view(this.account(botId)) }; });
  }

  listConversations(botId: string, limit: number, before?: number) {
    return this.guard(() => {
      this.account(botId);
      const rows = this.rows<Peer & { preview: string | null }>(
        `SELECT p.*, (SELECT substr(text,1,100) FROM messages m WHERE m.bot_id=p.bot_id AND m.peer_id=p.peer_id ORDER BY id DESC LIMIT 1) preview
         FROM peers p WHERE p.bot_id=? AND (? IS NULL OR p.last_message_at<?) ORDER BY p.last_message_at DESC LIMIT ?`,
        botId, before ?? null, before ?? null, limit);
      const now = Date.now();
      return {
        conversations: rows.map(p => ({
          conversation_id: p.peer_id, kind: p.kind, last_message_at: p.last_message_at, preview: p.preview,
          context_age_ms: p.context_at ? now - p.context_at : null,
          can_reply: p.kind === 'user' && !!p.context_token && p.context_status === 'ok',
        })),
      };
    });
  }

  readMessages(botId: string, conversationId: string | undefined, afterId: number, limit: number) {
    return this.guard(() => {
      this.account(botId);
      const rows = this.rows<Record<string, any>>(
        `SELECT id,peer_id,direction,from_user_id,text,items_json,create_time_ms,status,error FROM messages
         WHERE bot_id=? AND id>? AND (? IS NULL OR peer_id=?) ORDER BY id LIMIT ?`,
        botId, afterId, conversationId ?? null, conversationId ?? null, limit + 1);
      const page = rows.slice(0, limit);
      return {
        messages: page.map(m => ({
          id: m.id, conversation_id: m.peer_id, direction: m.direction, from: m.from_user_id, text: m.text, items: m.items_json ? JSON.parse(m.items_json) : [],
          create_time_ms: m.create_time_ms, status: m.status === 'pending' ? 'unknown' : m.status, ...(m.error ? { error: m.error } : {}),
        })),
        next_after_id: page.length ? page[page.length - 1].id : afterId,
        has_more: rows.length > limit,
      };
    });
  }

  /* ---------- Writes ---------- */

  sendText(botId: string, conversationId: string, text: string, clientId: string) {
    return this.guard(async () => {
      const account = this.account(botId);
      const prior = this.rows<{ id: number; status: string; error: string | null }>('SELECT id,status,error FROM messages WHERE bot_id=? AND client_id=?', botId, clientId)[0];
      if (prior) return { message_id: prior.id, status: prior.status === 'pending' ? 'unknown' : prior.status, deduplicated: true };
      const peer = this.rows<Peer>('SELECT * FROM peers WHERE bot_id=? AND peer_id=?', botId, conversationId)[0];
      if (!peer) return fail('未知会话：对方必须先给 Bot 发过消息');
      if (peer.kind === 'group') return fail('暂不支持向群会话发送');
      if (!peer.context_token) return fail('该会话没有可用的回复凭据，需要对方先发来消息');
      const now = Date.now();
      this.run(`INSERT INTO messages(bot_id,peer_id,direction,from_user_id,text,create_time_ms,received_at,client_id,status) VALUES(?,?,'out',?,?,?,?,?,'pending')`,
        botId, conversationId, botId, text, now, now, clientId);
      const id = this.rows<{ id: number }>('SELECT id FROM messages WHERE bot_id=? AND client_id=?', botId, clientId)[0].id;
      const settle = (status: string, error?: string) => this.run('UPDATE messages SET status=?,error=? WHERE id=?', status, error ?? null, id);
      try {
        await sendText(this.cfg, account.token, account.base_url, { to: conversationId, text, contextToken: peer.context_token, clientId });
      } catch (error) {
        if (error instanceof IlinkError && error.kind === 'rejected') {
          settle('failed', error.message);
          this.run(`UPDATE peers SET context_status='rejected' WHERE bot_id=? AND peer_id=? AND context_token=?`, botId, conversationId, peer.context_token);
          return fail(`发送被拒绝：${error.message}`);
        }
        if (error instanceof IlinkError && error.kind === 'http' && (error.code ?? 500) < 500) { settle('failed', error.message); return fail('发送失败'); }
        settle('unknown');
        return fail('发送结果未知，请先读取消息确认，不要重复发送');
      }
      settle('sent');
      return { message_id: id, status: 'sent', deduplicated: false };
    });
  }

  setPolling(botId: string, enabled: boolean) {
    return this.guard(async () => {
      const account = this.account(botId);
      if (enabled) this.run('UPDATE accounts SET enabled=1,paused_until=0,failures=0,next_poll_at=0,updated_at=? WHERE bot_id=?', Date.now(), botId);
      else this.run('UPDATE accounts SET enabled=0,updated_at=? WHERE bot_id=?', Date.now(), botId);
      await notify(this.cfg, account.token, account.base_url, enabled ? 'start' : 'stop');
      await this.rearm();
      return { account: this.view(this.account(botId)) };
    });
  }

  logout(botId: string) {
    return this.guard(async () => {
      const account = this.account(botId);
      await notify(this.cfg, account.token, account.base_url, 'stop');
      this.ctx.storage.transactionSync(() => {
        for (const table of ['messages', 'peers', 'accounts']) this.run(`DELETE FROM ${table} WHERE bot_id=?`, botId);
      });
      await this.rearm();
      return { deleted: true, account_id: botId };
    });
  }

  /* ---------- Poll loop ---------- */

  private due(now: number) {
    return this.rows<Account>('SELECT * FROM accounts WHERE enabled=1 AND paused_until<=? AND next_poll_at<=?', now, now);
  }
  /** Next alarm at the earliest due time; none when nothing is enabled. */
  private async rearm() {
    const next = this.rows<{ t: number | null }>('SELECT MIN(MAX(next_poll_at,paused_until)) t FROM accounts WHERE enabled=1')[0]?.t;
    if (next === null || next === undefined) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
  }
  private async ensureAlarm() {
    if (await this.ctx.storage.getAlarm() === null) await this.rearm();
  }

  async alarm() {
    const start = Date.now();
    // Watchdog first: if this run dies, the next one still starts.
    await this.ctx.storage.setAlarm(start + LIMITS.watchdogMs);
    try {
      while (Date.now() - start < LIMITS.loopMs) {
        const due = this.due(Date.now()).filter(a => !this.polling.has(a.bot_id));
        if (!due.length) break;
        await Promise.all(due.map(a => this.pollOne(a)));
      }
    } catch (error) {
      console.error('wechat alarm error', error instanceof Error ? error.name : 'unknown');
    } finally {
      await this.rearm();
    }
  }

  /** Never rejects: an unexpected error backs the account off instead of spinning the loop. */
  private async pollOne(account: Account) {
    try { await this.pollAccount(account); } catch (error) {
      console.error('wechat poll error', error instanceof Error ? error.name : 'unknown');
      try { this.pollFailed(account, '内部错误'); } catch { /* storage unavailable: the watchdog alarm retries */ }
    }
  }

  private async pollAccount(account: Account) {
    this.polling.add(account.bot_id);
    const started = Date.now();
    try {
      let result: UpdatesResult;
      try {
        result = await getUpdates(this.cfg, account.token, account.base_url, account.cursor, account.poll_timeout_ms ?? undefined);
      } catch (error) {
        return this.pollFailed(account, error instanceof IlinkError && error.kind === 'http' ? `HTTP ${error.code}` : '网络错误');
      }
      if (result.ret === SESSION_EXPIRED || result.errcode === SESSION_EXPIRED) return this.pollExpired(account);
      if (result.ret || result.errcode) return this.pollFailed(account, `ret ${result.ret || result.errcode}${result.errmsg ? `: ${result.errmsg}` : ''}`);
      this.pollApplied(account, result, started);
    } finally {
      this.polling.delete(account.bot_id);
    }
  }

  /** Writes are skipped when the account was removed or re-logged-in while the poll was in flight. */
  private ifCurrent(account: Account, write: () => void) {
    this.ctx.storage.transactionSync(() => {
      if (this.rows('SELECT 1 FROM accounts WHERE bot_id=? AND token=?', account.bot_id, account.token).length) write();
    });
  }

  private pollApplied(account: Account, result: UpdatesResult, started: number) {
    const now = Date.now();
    this.ifCurrent(account, () => {
      for (const m of result.messages) {
        this.run(`INSERT OR IGNORE INTO messages(bot_id,peer_id,direction,wx_message_id,seq,from_user_id,text,items_json,create_time_ms,received_at,status)
          VALUES(?,?,'in',?,?,?,?,?,?,?,'received')`,
          account.bot_id, m.peer, m.id, m.seq ?? null, m.from, m.text, JSON.stringify(m.items), m.createdMs, now);
        this.run(`INSERT INTO peers(bot_id,peer_id,kind,context_token,context_at,last_message_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(bot_id,peer_id) DO UPDATE SET
            context_token=CASE WHEN excluded.context_token IS NOT NULL AND excluded.context_at>=peers.context_at THEN excluded.context_token ELSE peers.context_token END,
            context_status=CASE WHEN excluded.context_token IS NOT NULL AND excluded.context_at>=peers.context_at THEN 'ok' ELSE peers.context_status END,
            context_at=MAX(peers.context_at,excluded.context_at),
            last_message_at=MAX(peers.last_message_at,excluded.last_message_at)`,
          account.bot_id, m.peer, m.group ? 'group' : 'user', m.contextToken ?? null, m.contextToken ? m.createdMs : 0, m.createdMs);
      }
      if (result.timedOut) {
        this.run('UPDATE accounts SET last_poll_at=?,next_poll_at=? WHERE bot_id=?', now, started + 1000, account.bot_id);
        return;
      }
      // The cursor only advances when the server returned a non-empty one.
      this.run(`UPDATE accounts SET cursor=?,poll_timeout_ms=?,failures=0,last_error=NULL,state='active',expired_streak=0,paused_until=0,last_poll_at=?,next_poll_at=? WHERE bot_id=?`,
        result.cursor || account.cursor, result.timeoutMs ?? account.poll_timeout_ms, now, started + 1000, account.bot_id);
      if (result.messages.length) {
        this.run(`DELETE FROM messages WHERE bot_id=? AND (received_at<? OR id<=COALESCE((SELECT id FROM messages WHERE bot_id=? ORDER BY id DESC LIMIT 1 OFFSET ?),0))`,
          account.bot_id, now - LIMITS.retentionMs, account.bot_id, LIMITS.retentionRows);
      }
    });
  }

  private pollExpired(account: Account) {
    const now = Date.now();
    this.ifCurrent(account, () => this.run(
      `UPDATE accounts SET state='expired',expired_streak=expired_streak+1,paused_until=?,last_poll_at=?,last_error=? WHERE bot_id=?`,
      now + LIMITS.expiredPauseMs, now, '会话已过期（-14），暂停一小时；连续出现请重新扫码登录', account.bot_id));
  }

  private pollFailed(account: Account, reason: string) {
    const now = Date.now(), failures = account.failures + 1;
    this.ifCurrent(account, () => this.run(
      'UPDATE accounts SET failures=?,next_poll_at=?,last_poll_at=?,last_error=? WHERE bot_id=?',
      failures, now + Math.min(2 ** failures, 300) * 1000, now, reason.slice(0, 200), account.bot_id));
  }
}

import { userPrompt } from './commands';
import { STATE_PREFIX, SUMMARY_PREFIX } from './instructions';
import { parseBook, parseCard } from './cards';
import type { Book, Entry, JsonObject, Message, Settings } from './types';
export const estimateTokens = (text: string) => Math.ceil([...text].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 1 : 0.4), 0));
export function macros(text: string, char: string, user: string, original = '') {
  return text.replace(/\{\{original\}\}/gi, () => original).replace(/\{\{char\}\}|<char>|<bot>/gi, () => char).replace(/\{\{user\}\}|<user>/gi, () => user);
}
function matches(entry: Entry, corpus: string) {
  if (!entry.enabled || entry.regex || !entry.content || /^\s*@@/m.test(entry.content)) return false;
  if (entry.constant) return true;
  const hay = entry.caseSensitive ? corpus : corpus.toLowerCase();
  const has = (key: string) => !!key && hay.includes(entry.caseSensitive ? key : key.toLowerCase());
  if (!entry.keys.some(has)) return false;
  if (!entry.selective) return true;
  if (!entry.secondary.length) return false;
  switch (entry.logic) { case 1: return !entry.secondary.every(has); case 2: return !entry.secondary.some(has); case 3: return entry.secondary.every(has); default: return entry.secondary.some(has); }
}
export function activateBook(book: Book, history: Pick<Message, 'content'>[], expand: (s: string) => string) {
  const corpus = book.scanDepth === 0 ? '' : history.slice(-book.scanDepth).map(m => m.content).join('\n');
  let scan = corpus; const picked = new Map<number, Entry>();
  for (let pass = 0; pass < (book.recursive ? 8 : 1); pass++) {
    let added = false;
    book.entries.forEach((entry, i) => { if (!picked.has(i) && matches(entry, scan)) { picked.set(i, entry); added = true; } });
    if (!added || !book.recursive) break;
    scan = corpus + '\n' + [...picked.values()].map(e => expand(e.content)).join('\n');
  }
  let used = 0;
  return [...picked.values()].sort((a,b) => b.priority-a.priority || a.order-b.order).filter(e => {
    const cost = estimateTokens(expand(e.content)); if (used + cost > book.budget) return false; used += cost; return true;
  }).sort((a,b) => a.order-b.order);
}
export type PromptMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: {id:string;type:'function';function:{name:string;arguments:string}}[] };
// Context layout changes must update docs/tavern/AGENT.md and src/pages/About.svelte.
export function buildPrompt(raw: JsonObject, books: Book[], history: Message[], settings: Settings, contextTokens: number | null, options: { protocol?: string; inputRatio?: number; summary?: string; state?:string; telegram?:boolean } = {}) {
  const card = parseCard(raw), c = card.data;
  const char = c.nickname || c.name, expand = (text: string, original = '') => macros(text, char, settings.userName, original);
  const activeHistory = history.filter(m => m.status === 'completed');
  const allBooks = c.character_book ? [parseBook(c.character_book), ...books] : books;
  const entries = allBooks.flatMap(b => activateBook(b, activeHistory, s => expand(s)));
  const systemText = (picked: Entry[]) => [expand(c.system_prompt ? (/\{\{original\}\}/i.test(c.system_prompt) ? c.system_prompt : '{{original}}\n\n' + c.system_prompt) : '{{original}}', settings.systemPrompt), settings.persona ? `${settings.userName}: ${settings.persona}` : '', ...picked.filter(e => e.position === 'before_char').map(e => expand(e.content)),
    expand(c.description), expand(c.personality), expand(c.scenario), ...picked.filter(e => e.position === 'after_char').map(e => expand(e.content)), c.mes_example ? `示例对白：\n${expand(c.mes_example)}` : ''].filter(Boolean).join('\n\n');
  const post = expand(c.post_history_instructions, '');
  const count = (s: string) => Math.ceil(estimateTokens(s) * (options.inputRatio ?? 1));
  const picked = entries;
  const selectedHistory = activeHistory;
  const system = [systemText(picked), post, options.protocol, options.summary ? SUMMARY_PREFIX + options.summary : ''].filter(Boolean).join('\n\n');
  const messages: PromptMessage[] = [{ role: 'system', content: system }, ...selectedHistory.map(m => ({ role: m.role, content: expand(m.role==='user'?userPrompt(m.content,options.telegram):m.content) }))];
  if(options.state){const at=messages.at(-1)?.role==='user'?messages.length-1:messages.length;messages.splice(at,0,stateMessage(options.state));}
  // Template allowance is part of context estimation, not an output budget.
  const estimatedTokens = messages.reduce((sum, m) => sum + count(m.content) + 8, 256);
  return { messages, estimatedTokens, activatedEntries: picked.map(e => e.id),
    needsCompression: contextTokens !== null && estimatedTokens > contextTokens,
    budget: { detectedContextTokens: contextTokens, includedMessages: selectedHistory.length, summaryTokens: count(options.summary ?? '') } };
}

export function stateMessage(state:string):PromptMessage{return {role:'user',content:STATE_PREFIX+state};}

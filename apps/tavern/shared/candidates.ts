export const CANDIDATE_TASK = '正文已经完成。现在只生成三条用户可直接发送的后续行动或台词，各一行，互不重复，每条15–60字且不超过120字；承接最新故事，不写角色回答、不虚构已发生事实。不输出正文、说明、序号或JSON。';
const MAX_TAIL_BYTES = 2048;
export const CANDIDATE_REMINDER = '【应用输出格式】本轮正文后必须另起一行输出 [TAVERN_NEXT]，再逐行给出三条用户可直接发送的台词或行动；不要只输出正文，不用JSON。';
export function candidateDelimiter() { return '\n[TAVERN_NEXT]\n'; }
export function candidateInstruction() {
 return `每一轮回复都必须完成两个部分：角色正文 + 用户续聊候选；续写和重新生成也一样。正文写完并不代表任务完成，必须继续输出分隔符和候选，不可省略。
严格使用以下格式（尖括号只是占位说明，输出时替换为内容，不输出尖括号或说明）：
<角色正文>
[TAVERN_NEXT]
<一条用户可直接发送的台词或行动>
<另一条方向不同的用户台词或行动>
<第三条方向不同的用户台词或行动>
实际输出候选时不要写“候选一”等标签或序号，每条只占一行；只用换行分隔，不加JSON、代码围栏或额外说明。候选承接本轮故事，必须三条且互不重复；每条15–60字且不超过120字。以用户视角写，不替用户作决定，不把尚未发生的事写成事实，不写角色的回答或抽象标签。正文结束后继续完成三条候选。`;
}
export function validateCandidates(value: unknown): string[] {
 if (!Array.isArray(value)) return [];
 const found = new Set<string>();
 for (const item of value) {
  if (typeof item !== 'string') continue;
  const text = item.trim();
  if (!text || [...text].length > 120 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) continue;
  found.add(text); if (found.size === 3) break;
 }
 return [...found];
}
/** A bounded delimiter parser. Potential marker prefixes are held until disambiguated. */
export class CandidateStream {
 private buffer = ''; private tail = ''; private overflow = false; private pendingCR = false;
 private readonly markers: string[];
 inTail = false;
 constructor(marker: string = candidateDelimiter()) {
  this.markers = marker === candidateDelimiter() ? [marker, marker.slice(1)] : [marker];
 }
 push(text: string): string {
  const joined = (this.pendingCR ? '\r' : '') + text;
  this.pendingCR = joined.endsWith('\r');
  text = (this.pendingCR ? joined.slice(0, -1) : joined).replace(/\r\n?/g, '\n');
  if (this.inTail) { this.appendTail(text); return ''; }
  this.buffer += text;
  let start = -1, matched = '';
  for (const marker of this.markers) {
   const index = this.buffer.indexOf(marker);
   if (index >= 0 && (start < 0 || index < start)) { start = index; matched = marker; }
  }
  if (start >= 0) {
   const body = this.buffer.slice(0, start); this.inTail = true;
   this.appendTail(this.buffer.slice(start + matched.length)); this.buffer = ''; return body;
  }
  let hold = Math.min(this.buffer.length, Math.max(...this.markers.map(marker => marker.length)) - 1);
  while (hold && !this.markers.some(marker => marker.startsWith(this.buffer.slice(-hold)))) hold--;
  const body = this.buffer.slice(0, this.buffer.length - hold);
  this.buffer = hold ? this.buffer.slice(-hold) : ''; return body;
 }
 private appendTail(text: string) {
  if (this.overflow) return;
  this.tail += text;
  if (new TextEncoder().encode(this.tail).length > MAX_TAIL_BYTES) { this.overflow = true; this.tail = ''; }
 }
 finish(): { body: string; candidates: string[] } {
  // An incomplete delimiter is protocol, never persisted as story text.
  const flushed = this.pendingCR ? this.push('\n') : '';
  const body = flushed + (!this.inTail && !(this.buffer.length > 1 && this.markers.some(marker => marker.startsWith(this.buffer))) ? this.buffer : '');
  this.buffer = '';
  if (!this.inTail || this.overflow) return { body, candidates: [] };
  const lines = this.tail.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.some(line => /^(?:```|[{}\[\]])/.test(line))) return { body, candidates: [] };
  return { body, candidates: validateCandidates(lines.map(line => line.replace(/^(?:[-*•]\s+|\d+[.)、]\s*)/u, ''))) };
 }
}

/** Used only for the explicit candidate-only model task, never ordinary story text. */
export function recoveryCandidates(text: string): string[] {
 const parser = new CandidateStream();
 const trimmed = text.trim();
 parser.push(trimmed.includes('[TAVERN_NEXT]') ? trimmed : candidateDelimiter() + trimmed);
 return parser.finish().candidates;
}

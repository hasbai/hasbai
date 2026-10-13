const MAX_TAIL_BYTES = 2048;
export function candidateDelimiter() { return '\n[TAVERN_NEXT]\n'; }
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

/** Parses UTF-8 SSE across arbitrary network chunk boundaries. */
export async function* sseData(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = stream.getReader(), decoder = new TextDecoder(); let buffer = '';
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new Error('生成已停止');
      const { value, done } = await reader.read(); buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 1024 * 1024) throw new Error('流式事件过大');
      buffer = buffer.replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
        if (data) yield data;
      }
      if (done) {
        const rest = buffer.trim();
        if (rest) {
          const lines = rest.split('\n').map(l => l.trim()).filter(Boolean);
          if (lines.every(l => l.startsWith(':'))) break;
          const data = lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
          if (data === '[DONE]' && lines.every(l => l.startsWith('data:') || l.startsWith(':'))) { yield '[DONE]'; break; }
          throw new Error('流式响应被截断');
        }
        break;
      }
    }
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

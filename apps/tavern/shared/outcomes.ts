import type { FinishReason } from './types';

export function mapUpstreamFinishReason(reason?: string | null): FinishReason {
 const normalized = reason?.trim().toLowerCase();
 if (!normalized) return 'interrupted';
 if (normalized === 'stop' || normalized === 'end_turn' || normalized === 'stop_sequence') return 'stop';
 if (normalized === 'length' || normalized === 'max_tokens' || normalized === 'model_context_window_exceeded') return 'length';
 if (['content_filter', 'safety', 'recitation', 'prohibited_content', 'spii', 'blocklist', 'refusal', 'sensitive'].includes(normalized)) return 'content_filter';
 if (normalized === 'malformed_function_call') return 'invalid_output';
 if (normalized === 'error') return 'upstream';
 if (normalized === 'abort' || normalized === 'canceled' || normalized === 'cancelled') return 'interrupted';
 return 'unsupported';
}

export function isToolCapableFinish(reason?: string | null, hasToolCalls = false): boolean {
 const normalized = reason?.trim().toLowerCase();
 if (!normalized) return false;
 if (normalized === 'tool_calls' || normalized === 'function_call' || normalized === 'tool_use') return true;
 return hasToolCalls && (normalized === 'stop' || normalized === 'end_turn');
}

export function generationNotice(reason?: FinishReason | null): string {
 switch(reason){
  case 'invalid_output': return '模型输出异常，未提交剧情状态';
  case 'length': return '回复达到长度上限，内容已保存';
  case 'timeout': return '生成超时，内容已保存';
  case 'stopped': return '已停止生成';
  case 'disconnected': return '连接断开，内容已保存';
  case 'rate_limited': return '模型服务限流或额度受限，请稍后重试';
  case 'content_filter': return '模型未返回可用内容';
  case 'unsupported': return '模型返回了不支持的结束类型';
  case 'empty': return '模型未返回正文，请重试';
  case 'output_limit': return '回复超过大小上限，内容已保存';
  case 'expired': return '生成已中断，内容已保存';
  case 'interrupted': return '模型响应中断，内容已保存';
  default: return '生成失败，请重试';
 }
}

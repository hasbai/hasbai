import type { FinishReason } from './types';
export function generationNotice(reason?: FinishReason | null): string {
 switch(reason){
  case 'review_failed': return '正文未完成叙事审核，未提交剧情状态；请重试或调整输入';
  case 'length': return '回复达到长度上限，内容已保存';
  case 'timeout': return '生成超时，内容已保存';
  case 'stopped': return '已停止生成';
  case 'disconnected': return '连接断开，内容已保存';
  case 'content_filter': return '模型未返回可用内容';
  case 'unsupported': return '模型返回了不支持的结束类型';
  case 'empty': return '模型未返回正文，请重试';
  case 'output_limit': return '回复超过大小上限，内容已保存';
  case 'expired': return '生成已中断，内容已保存';
  case 'interrupted': return '模型响应中断，内容已保存';
  default: return '生成失败，请重试';
 }
}

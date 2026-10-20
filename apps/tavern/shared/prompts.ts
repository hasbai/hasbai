import { DIRECTOR_RULE, SUMMARY_TASK, CHARACTER_RULE, TOOL_RULE, TOOL_PROMPTS } from './instructions';
import { DEFAULT_SYSTEM_PROMPT } from './types';

// Only text is editable; roles, ordering and native schemas remain in code.
export const DEFAULT_PROMPTS = {
 systemTemplate:DEFAULT_SYSTEM_PROMPT, character:CHARACTER_RULE, tools:TOOL_RULE,
 director:DIRECTOR_RULE, summaryTask:SUMMARY_TASK, ...TOOL_PROMPTS,
};
export type PromptTexts = typeof DEFAULT_PROMPTS;
export type PromptKey = keyof PromptTexts;
export type PromptDocument = {revision:string; texts:PromptTexts};
export type PromptConfiguration = PromptDocument & {admin:boolean};
export const PROMPT_KEY = 'dialogue-v3';
export const PROMPT_LABELS:Record<PromptKey,string> = {
 systemTemplate:'默认系统提示词模板', character:'角色卡创作', tools:'工具使用指导',
 director:'候选规则', summaryTask:'压缩任务',
 searchDescription:'search_memory · 检索说明', readDescription:'read_memory · 读取说明',
 readIdDescription:'记忆 ID', readOffsetDescription:'读取位置', updateDescription:'update_state · 更新说明',
 goalsDescription:'目标记录', goalTaskDescription:'目标事项', goalProgressDescription:'已确认进展',
 goalPauseDescription:'暂停原因', goalEvidenceDescription:'完成证据',
};
export const TOOL_PROMPT_KEYS = Object.keys(TOOL_PROMPTS) as (keyof typeof TOOL_PROMPTS)[];

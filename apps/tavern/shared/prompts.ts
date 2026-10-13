import { AGENT_RULE, DIRECTOR_RULE, SUMMARY_TASK, CHARACTER_RULE } from './instructions';
import { DEFAULT_SYSTEM_PROMPT } from './types';

// Editable application text. Roles, ordering and native schemas remain in code.
// Changes must also update docs/tavern and the About use cases.
export const DEFAULT_PROMPTS = {
 systemTemplate:DEFAULT_SYSTEM_PROMPT, character:CHARACTER_RULE, agent:AGENT_RULE,
 director:DIRECTOR_RULE, summaryTask:SUMMARY_TASK,
};
export type PromptTexts = typeof DEFAULT_PROMPTS;
export type PromptKey = keyof PromptTexts;
export type PromptDocument = {revision:string; texts:PromptTexts};
export type PromptConfiguration = PromptDocument & {admin:boolean};
export const PROMPT_KEY = 'dialogue-v2';
export const PROMPT_LABELS:Record<PromptKey,string> = {
 systemTemplate:'默认系统提示词模板', character:'角色卡创作', agent:'正文协议',
 director:'候选规则', summaryTask:'压缩任务',
};

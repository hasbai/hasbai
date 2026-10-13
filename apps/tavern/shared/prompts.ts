import { AGENT_RULE, DIRECTOR_RULE, SUMMARY_RULE, SUMMARY_TASK, CONTINUE_REPLY, CONTINUE_BODY, REPAIR_INSTRUCTION, REPAIR_PROBLEMS, CARD_POST_ORIGINAL, CHARACTER_RULE } from './instructions';

// Editable application text. Roles, ordering and native schemas remain in code.
// Changes must also update docs/tavern and the About use cases.
export const DEFAULT_PROMPTS = {
 character:CHARACTER_RULE, agent:AGENT_RULE, director:DIRECTOR_RULE, summary:SUMMARY_RULE, summaryTask:SUMMARY_TASK,
 continueReply:CONTINUE_REPLY, continueBody:CONTINUE_BODY, repair:REPAIR_INSTRUCTION,
 repairIncompleteThink:REPAIR_PROBLEMS.incompleteThink, repairRepeatedParagraph:REPAIR_PROBLEMS.repeatedParagraph,
 repairRepeatedHistory:REPAIR_PROBLEMS.repeatedHistory, repairExposedThink:REPAIR_PROBLEMS.exposedThink,
 cardPostOriginal:CARD_POST_ORIGINAL,
};
export type PromptTexts = typeof DEFAULT_PROMPTS;
export type PromptKey = keyof PromptTexts;
export type PromptDocument = {revision:string; texts:PromptTexts};
export type PromptConfiguration = PromptDocument & {admin:boolean};
export const PROMPT_KEY = 'dialogue-v1';
export const PROMPT_LABELS:Record<PromptKey,string> = {
 character:'角色卡创作', agent:'正文协议', director:'候选规则', summary:'摘要规则', summaryTask:'压缩任务',
 continueReply:'手动继续', continueBody:'自动续写', repair:'修订要求',
 repairIncompleteThink:'未完成思考标记', repairRepeatedParagraph:'本轮段落重复',
 repairRepeatedHistory:'重复历史正文', repairExposedThink:'思考标记泄露', cardPostOriginal:'角色卡 original 后置文本',
};

import { DEFAULT_SETTINGS, LEGACY_SYSTEM_PROMPT, PREVIOUS_SYSTEM_PROMPT, type Settings } from './types';

/** Missing keys in historic snapshots receive defaults; explicit invalid values never do. */
export function normalizeSettings(value: unknown): Settings {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置无效');
 const v = { ...DEFAULT_SETTINGS, ...value };
 if (v.systemPrompt === LEGACY_SYSTEM_PROMPT || v.systemPrompt === PREVIOUS_SYSTEM_PROMPT) v.systemPrompt = DEFAULT_SETTINGS.systemPrompt;
 const range = (n: unknown, min: number, max: number, integer = false) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n));
 if (typeof v.userName !== 'string' || !v.userName.trim() || v.userName.length > 80) throw new Error('请检查你的名字');
 if (typeof v.persona !== 'string' || v.persona.length > 12000 || typeof v.systemPrompt !== 'string' || !v.systemPrompt.trim() || v.systemPrompt.length > 12000) throw new Error('请检查角色设定与系统提示');
 if (v.modelId !== 'rp') throw new Error('模型不可用');
 if (typeof v.thinkingEnabled !== 'boolean') throw new Error('请检查思考开关');
 if (!['low', 'medium', 'high'].includes(v.reasoningEffort)) throw new Error('请检查思考强度');
 if (!range(v.temperature, 0, 2)) throw new Error('温度需为 0–2');
 if (!range(v.topP, Number.MIN_VALUE, 1)) throw new Error('Top P 需大于 0 且不超过 1');
 if (!range(v.topK, 0, 1000, true)) throw new Error('Top K 需为 0–1000 的整数');
 if (!range(v.frequencyPenalty, -2, 2) || !range(v.presencePenalty, -2, 2)) throw new Error('惩罚参数需为 −2–2');
 return { userName: v.userName.trim(), persona: v.persona, systemPrompt: v.systemPrompt, modelId: v.modelId, thinkingEnabled: v.thinkingEnabled, reasoningEffort: v.reasoningEffort, temperature: v.temperature, topP: v.topP, topK: v.topK, frequencyPenalty: v.frequencyPenalty, presencePenalty: v.presencePenalty };
}

import { AI_ORIGIN, runAI } from '@hasbai/ai';
export const ROLEPLAY_GATEWAY_URL = AI_ORIGIN + '/v1/chat/completions';
/** The AI Worker owns upstream routing, credentials and Gateway logging. */
export function runRoleplay(env: Env, username: string, requestId: string, input: Record<string, unknown>, signal: AbortSignal, task: 'roleplay' | 'character-generation' = 'roleplay') {
  return runAI(env.AI_SERVICE, task, {...input, model: input.model ?? 'rp'}, {app: 'tavern', username, requestId}, signal);
}

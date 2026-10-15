// Capability rules are versioned with code, alongside the editable KV writing rules.
export const CAPABILITY_RULES = {
 body: '记忆与目标协议：检索片段不足时，用read_memory读取search_memory返回的id；从offset 0开始，按nextOffset逐页核对原文。只引用有效来源，不把旧说法当最新更正。收到明确委托时用update_state记录goals，以稳定名称为键；task是委托，actor区分character与player，status为active/paused/completed，progress只记已确认进展。暂停时填写pauseReason，只有用户明确恢复才能解除；回顾不是恢复。同一目标的actor不变。完成时在completionEvidence逐字引用一条完整原句（保留标点），先叙述实际完成的动作，再更新目标；计划、候选和待用户决定的事不能算完成。玩家目标只能以用户已确认的行动为完成证据。已完成目标不重启，新委托另建目标。pauseReason与completionEvidence不适用时用null；不删除目标来绕过暂停或完成状态。',
 director: '目标边界：候选遵守goals中的暂停和完成状态。回顾不解除暂停，不重启已完成委托；player目标的选择仍由用户确认。',
 summary: '记忆边界：保留事实更正、委托、已确认进展、暂停与恢复、完成证据及尚待玩家决定的事项；区分计划与实际结果。',
} as const;
export function capabilityProtocol(stage:keyof typeof CAPABILITY_RULES, configured:string):string {
 return configured+'\n\n'+CAPABILITY_RULES[stage];
}

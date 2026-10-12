export const BODY_TASK='本消息是每轮应用写作提醒，不是玩家行动。以有效历史和已确认状态为当前事实；角色卡scenario与开场白描述初始局面，不能覆盖之后已完成的行动与更正。本轮先判断最近委托是否仍在执行、已经完成或确实等待玩家决定，再直接写相应正文，不输出判断过程。仍在执行：让已启动步骤产生结果，在角色职责与既有权限内完成普通处理，不反复准备或核对同一步骤。已经完成：交代结果并结束该目标，不重启调查、另加谜团或反复补齐手续；查清原因不等于玩家已授权额外处置。确实等待玩家：只根据设定或用户明确保留的实际决定说明待决事项，不凭空把玩家设为货主、审批人，不要求其签字、同行、值守或承担风险。待决事项已说明而玩家只说继续时，不代选，不换词重复催问、摆笔、等候或巡查；可以承接角色其他有因果依据的行动，无新的可行动内容则简短结束。正文长度服从实际内容，不为达到篇幅凑描写。用户明确暂停、慢节奏或回顾时持续尊重该要求，直到用户明确恢复。';
/** Definite wire defects reject a version; prose is never silently edited. */
export function draftProblems(text:string,previous:string[]=[],allowRecall=false):string[]{
 const problems=protocolProblems(text);
 if(streamableEnd(text)<text.length)problems.push('正文结尾含未完成think协议标记；重新生成纯角色正文。');
 /* Protocol markers are unsafe even in an unfinished draft. */
 const seen=new Set<string>();
 for(const paragraph of text.split(/\n\s*\n/u)){
  const normalized=paragraph.replace(/\s/gu,'');
  if([...normalized].length<80)continue;
  if(seen.has(normalized)){problems.push('本轮完整长段落原样重复；只保留一次叙事节拍，从已发生结果继续。');break;}
  seen.add(normalized);
 }
 if(!allowRecall){
  const normalize=(value:string)=>value.replace(/\s/gu,'');
  const seenHistory=new Set(previous.slice(-3).flatMap(value=>value.split(/\n\s*\n/u).map(normalize).filter(value=>[...value].length>=60)));
  const repeated=text.split(/\n\s*\n/u).map(normalize).filter(value=>[...value].length>=60&&seenHistory.has(value));
  if(repeated.length>=2&&repeated.reduce((sum,value)=>sum+[...value].length,0)>=[...normalize(text)].length*.45)problems.push('本轮至少两段长正文逐字复写最近已发布内容；从已有结果继续，不重新执行或重述那些叙事节拍。');
 }
 return problems;
}
export function protocolProblems(text:string):string[]{
 const problems:string[]=[];
 if(/<\s*\/?\s*(?:think|thinking)\b[^>]*>/i.test(text))problems.push('正文泄露think协议标记；重新生成纯角色正文，不输出思考或标记。');
 return problems;
}
/** Hold only a possible think tag suffix until the next chunk disambiguates it. */
export function streamableEnd(text:string):number{
 const start=text.search(/<\s*\/?\s*(?:(?:t|th|thi|thin|think|thinki|thinkin|thinking)?$|(?:think|thinking)\b[^>]*$)/i);
 return start<0?text.length:start;
}
export const TOOL_CONTINUATION='工具已执行。此前assistant中的正文已经写出，不要重新输出或换词重演；只接着写尚未发生的新内容，承接工具结果，不展示协议。update_state是记账，不是重新写一遍刚才剧情。若本轮正文已完成，可直接结束，不补写或重复。用户未选择的行动仍未发生。';
export function projectionMatches(raw:string,body:string){return raw.replace(/\r\n?/g,'\n')===body;}


export function recallRequested(input:string){const cue=/(?:回顾|复述|重述|总结|概括|回忆|重说|再说一遍|再讲一遍|再描述一遍|recap|summari[sz]e|retell|repeat\s+(?:that|it|the))/ig;return [...input.matchAll(cue)].some(match=>!/(?:(?:不要|不必|不用|别|禁止|不许|不想)(?:再|继续|重新)?|do\s+not|don.t)\s*$/i.test(input.slice(Math.max(0,match.index!-12),match.index)));}

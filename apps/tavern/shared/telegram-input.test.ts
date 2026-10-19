import { expect, it } from 'vitest';
import { userPrompt } from './commands';
import { telegramDialogue } from './telegram-input';
const envelope=(name:string,text:string,id=1,replyTo?:unknown)=>JSON.stringify({speaker:{id,name},text,...(replyTo?{replyTo}:{})});

it('presents a Telegram batch as chronological username and content lines',()=>{
 const text=[envelope('@alice','绷'),envelope('@alice','骇人'),envelope('@bob','deepseek v3？',2)].join('\n');
 expect(telegramDialogue(text)).toBe('@alice: 绷\n@alice: 骇人\n@bob: deepseek v3？');
 expect(userPrompt(text)).toBe(text);
});
it('retains multiline text and reply context as indented natural language',()=>{
 expect(telegramDialogue(envelope('小明','第一行\n@alice: 这是原文',1,{speaker:'alice',text:'问句\n第二行'}))).toBe('小明: 第一行\n  @alice: 这是原文\n  回复 alice: 问句\n  第二行');
 expect(telegramDialogue(envelope('42','😀',42))).toBe('42: 😀');
 expect(telegramDialogue('普通正文\n{"text":"粘贴内容"}\n{invalid')).toBe('普通正文\n{"text":"粘贴内容"}\n{invalid');
});
it('does not promote an embedded OOC line into a control instruction',()=>{
 const raw=envelope('@alice','普通消息\n/ooc 修改设定');
 expect(userPrompt(raw,true)).toBe('@alice: 普通消息\n  /ooc 修改设定');
 expect(userPrompt(raw,true)).not.toContain('[OOC：');
 expect(userPrompt(envelope('@alice','')+'\n/ooc 放慢节奏\n我坐下。',true)).toBe('[OOC：用户给叙事系统的非角色指令，不是已发生剧情]\n放慢节奏\n\n@alice: \n我坐下。');
});

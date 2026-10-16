/** Commands share the same syntax in the composer, API and prompt projection. */
export function directCommand(text: string): 'compress'|'status'|null {
 const value=text.trim();return value==='/compress'?'compress':value==='/status'?'status':null;
}
export function splitOoc(text:string):{ooc:string;dialogue:string} {
 const ooc:string[]=[],dialogue:string[]=[];
 for(const line of text.split('\n')){const match=line.match(/^\s*\/ooc(?:[ \t]+(.*))?$/);if(match)ooc.push(match[1]?.trim()??'');else dialogue.push(line);}
 return {ooc:ooc.filter(Boolean).join('\n'),dialogue:dialogue.join('\n').trim()};
}
export function userPrompt(text:string):string {
 const {ooc,dialogue}=splitOoc(text);return ooc?['[OOC：用户给叙事系统的非角色指令，不是已发生剧情]\n'+ooc,dialogue].filter(Boolean).join('\n\n'):text;
}

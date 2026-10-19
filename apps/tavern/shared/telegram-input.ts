const indent=(text:string)=>text.replace(/\r?\n/g,'\n  ');

/** Project persisted Telegram envelopes without changing the source messages. */
export function telegramDialogue(text:string):string {
 return text.split('\n').map(line=>{
  if(!line.startsWith('{'))return line;
  let value;try{value=JSON.parse(line);}catch{return line;}
  if(!value||typeof value!=='object'||!Number.isSafeInteger(value.speaker?.id)||typeof value.speaker?.name!=='string'||typeof value.text!=='string')return line;
  const name=value.speaker.name.replace(/[\r\n]/g,' ');
  const reply=value.replyTo;
  return `${name}: ${indent(value.text)}`+(reply&&typeof reply.speaker==='string'&&typeof reply.text==='string'?`\n  回复 ${reply.speaker.replace(/[\r\n]/g,' ')||'消息'}: ${indent(reply.text)}`:'');
 }).join('\n');
}

const OUTPUT_PROBLEMS={incompleteThink:'未完成思考标记',repeatedParagraph:'段落重复',repeatedHistory:'历史复写',exposedThink:'思考标记泄露'};
/** Output checks mark an error without editing or regenerating prose. */
export function draftProblems(text:string,previous:string[]=[],allowRecall=false):string[]{
 const problems=protocolProblems(text);
 if(streamableEnd(text)<text.length)problems.push(OUTPUT_PROBLEMS.incompleteThink);
 /* Protocol markers are unsafe even in an unfinished draft. */
 const seen=new Set<string>();
 for(const paragraph of text.split(/\n\s*\n/u)){
  const normalized=paragraph.replace(/\s/gu,'');
  if([...normalized].length<80)continue;
  if(seen.has(normalized)){problems.push(OUTPUT_PROBLEMS.repeatedParagraph);break;}
  seen.add(normalized);
 }
 if(!allowRecall){
  const normalize=(value:string)=>value.replace(/\s/gu,'');
  const seenHistory=new Set(previous.slice(-3).flatMap(value=>value.split(/\n\s*\n/u).map(normalize).filter(value=>[...value].length>=60)));
  const repeated=text.split(/\n\s*\n/u).map(normalize).filter(value=>[...value].length>=60&&seenHistory.has(value));
  if(repeated.length>=2&&repeated.reduce((sum,value)=>sum+[...value].length,0)>=[...normalize(text)].length*.45)problems.push(OUTPUT_PROBLEMS.repeatedHistory);
 }
 return problems;
}
export function protocolProblems(text:string):string[]{
 const problems:string[]=[];
 if(/<\s*\/?\s*(?:think|thinking)\b[^>]*>/i.test(text))problems.push(OUTPUT_PROBLEMS.exposedThink);
 return problems;
}
/** Detect an unfinished think tag suffix. */
export function streamableEnd(text:string):number{
 const start=text.search(/<\s*\/?\s*(?:(?:t|th|thi|thin|think|thinki|thinkin|thinking)?$|(?:think|thinking)\b[^>]*$)/i);
 return start<0?text.length:start;
}

export function recallRequested(input:string){const cue=/(?:回顾|复述|重述|总结|概括|回忆|重说|再说一遍|再讲一遍|再描述一遍|recap|summari[sz]e|retell|repeat\s+(?:that|it|the))/ig;return [...input.matchAll(cue)].some(match=>!/(?:(?:不要|不必|不用|别|禁止|不许|不想)(?:再|继续|重新)?|do\s+not|don.t)\s*$/i.test(input.slice(Math.max(0,match.index!-12),match.index)));}

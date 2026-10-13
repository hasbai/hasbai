import {it,expect} from 'vitest';
import {draftProblems,recallRequested,streamableEnd} from './narrative';
it('holds possible reasoning tags without delaying plain prose or ordinary markup',()=>{
 for(const tag of ['<','< / ','<t','< THI','</think','<thinking','<think private','<thinking\n','<think data="<span','<think 内容<']){
  expect(streamableEnd('正文。'+tag)).toBe(3);expect(draftProblems('正文。'+tag)).toHaveLength(1);
 }
 for(const prose of ['正文。','正文。<b>强调</b>','正文。<three','正文。<thought>'])expect(streamableEnd(prose)).toBe(prose.length);
});
it('rejects exposed reasoning markers and complete long paragraph duplication',()=>{
 const paragraph='灯下的账单上留着一处需要核对的编号。'.repeat(8);
 expect(draftProblems(paragraph+'\n\n'+paragraph)).toHaveLength(1);
 for(const tag of ['</think>','<thinking>','< THINK >','< / Thinking >'])expect(draftProblems('正文。'+tag)).toHaveLength(1);
 expect(draftProblems('她核对账单。\n\n她指出了漏记的交接签名。')).toEqual([]);
});
it('blocks substantial verbatim replay of recent prose but permits requested recap and brief references',()=>{
 const a='岚逐项核对那份货单的库位编号、交付签名与入库时间，将缺少签字的栏目用笔圈出，接着把同一批货的记录移到台灯下面。她又翻开交付登记的下一页，对照两处各自独立的经手人签字。',b='记录里的货物尚未获得复核签名，也没有装车放行的记录。岚据此确认货物仍卡在待复核环节，随后合上账簿，把核对结果放在桌面。他们还需要核对复核人员的值班时间，确认这一栏是漏填还是尚未办理。';
 expect(draftProblems(a+'\n\n'+b,[a+'\n\n'+b])).toHaveLength(1);expect(draftProblems(a+'\n\n'+b,[a+'\n\n'+b],true)).toEqual([]);expect(draftProblems(a+'\n\n她查明了新的签字人。',[a+'\n\n'+b])).toEqual([]);
});
it('limits cross-turn recall exemptions to affirmative requests',()=>{expect(recallRequested('请简短回顾已确认事实')).toBe(true);expect(recallRequested('不要复述旧段落，继续')).toBe(false);expect(recallRequested('别再回顾')).toBe(false);expect(recallRequested("don't repeat that")).toBe(false);});

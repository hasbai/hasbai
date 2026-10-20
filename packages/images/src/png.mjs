/** Publish image pixels without the character card or other textual metadata. */
export function publicPng(bytes) {
 if(bytes.length<8||![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return bytes;
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),parts=[bytes.subarray(0,8)];let offset=8,ended=false;
 while(offset+12<=bytes.length){const length=view.getUint32(offset),end=offset+length+12;if(end>bytes.length)throw Error('PNG 区块截断');const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));if(!['tEXt','zTXt','iTXt','eXIf'].includes(type))parts.push(bytes.subarray(offset,end));offset=end;if(type==='IEND'){ended=true;break;}}
 if(!ended)throw Error('PNG 缺少结束区块');const out=new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0));let position=0;for(const part of parts){out.set(part,position);position+=part.length;}return out;
}

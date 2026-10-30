/** Incremental Thai word boundaries; never split a combining character from its word. */
export class SpokenChunks {
 private pending='';
 private first=true;
 private words=new Intl.Segmenter('th',{granularity:'word'});
 private firstLimit:number;
 private firstLookahead:number;
 constructor(firstLimit=40,firstLookahead=15) {
  this.firstLimit=firstLimit;this.firstLookahead=firstLookahead;
 }
 push(token:string,final=false):string[]{
  this.pending+=token;const chunks:string[]=[];
  while(this.pending.trim()){
   const limit=this.first?this.firstLimit:85;
   const punctuation=/[.!?。！？\n](?:\s|$)/u.exec(this.pending);
   let at=punctuation&&punctuation.index>=12?punctuation.index+1:0;
   if(!at&&this.pending.length>=limit+(this.first?this.firstLookahead:15)){
    // Thai compounds are often segmented into dictionary words without spaces
    // (for example ช็อป|ปิ้ง, ยืด|เยื้อ, ทำ|ให้). Wait for a nearby phrase
    // boundary before falling back to a dictionary boundary.
    const lookahead=this.first?60:40;
    const natural=/\s/u.exec(this.pending.slice(limit,limit+lookahead+1));
    if(natural)at=limit+natural.index;
    else if(this.pending.length>=limit+lookahead)for(const part of this.words.segment(this.pending)){
     const end=part.index+part.segment.length;
     if(end>limit)break;
     at=end;
    }
   }
   if(!at){if(!final)break;at=this.pending.length;}
   const text=this.pending.slice(0,at).trim();this.pending=this.pending.slice(at);
   if(text){chunks.push(text);this.first=false;}
  }
  return chunks;
 }
}

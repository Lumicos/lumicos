const THAI_CONSONANT='ก-ฮ';

/**
 * Approximate Thai written-vowel groups from Thai orthography. This is a visual
 * mapper, not a pronunciation or phoneme parser. Leading vowels are handled
 * before dependent marks, and common Thai diphthongs stay intact.
 */
function thaiVisemes(text){
 const result=[];
 const source=String(text).normalize('NFKC');
 // Match complete vowel spellings before their individual dependent signs.
 // Tone/shortening marks may sit between vowel components; อ is also a
 // consonant carrier, so its following explicit vowel takes precedence.
 const marks='[่-๋็์]*';
 const onset=`[${THAI_CONSONANT}][${THAI_CONSONANT}]?`;
 const patterns=[
  [new RegExp(`^เ${onset}ี${marks}ย`,'u'),'I'],
  [new RegExp(`^เ${onset}ื${marks}อ`,'u'),'U'],
  [new RegExp(`^[${THAI_CONSONANT}]ั${marks}ว`,'u'),'U'],
  [new RegExp(`^เ${onset}${marks}า`,'u'),'O'],
  [new RegExp(`^[ไใ][${THAI_CONSONANT}]${marks}`,'u'),'A'],
  [new RegExp(`^เ${onset}${marks}อ`,'u'),'O'],
  [new RegExp(`^เ[${THAI_CONSONANT}]${marks}`,'u'),'E'],
  [new RegExp(`^แ[${THAI_CONSONANT}]${marks}`,'u'),'E'],
  [new RegExp(`^โ[${THAI_CONSONANT}]${marks}`,'u'),'O'],
  [new RegExp(`^[${THAI_CONSONANT}]${marks}[ิี]${marks}`,'u'),'I'],
  [new RegExp(`^[${THAI_CONSONANT}]${marks}[ุูึื]${marks}`,'u'),'U'],
  [new RegExp(`^[${THAI_CONSONANT}]${marks}[ะัา]${marks}`,'u'),'A'],
  [new RegExp(`^[${THAI_CONSONANT}]${marks}อ`,'u'),'O'],
 ];
 let rest=source,cursor=0;
 while(rest){
  const leading=rest.search(/[ก-ฮเแโใไ]/u);
  if(leading<0)break;
  rest=rest.slice(leading);cursor+=leading;
  let found;
  for(const [pattern,viseme] of patterns){const match=rest.match(pattern);if(match){found={length:match[0].length,viseme};break}}
  if(found){result.push({index:cursor,viseme:found.viseme});rest=rest.slice(Math.max(1,found.length));cursor+=Math.max(1,found.length);}
  else {const char=Array.from(rest)[0];rest=rest.slice(char.length);cursor+=char.length;}
 }
 return result;
}

const englishGroups=[
 [/^(?:eigh|ey)/i,'E'],
 [/^(?:igh|ee|ie|ei)/i,'I'],
 [/^(?:oo|ue|ew|ui|ou)/i,'U'],
 [/^(?:oa|oe|ow|oi|oy|or|ough)/i,'O'],
 [/^(?:ai|ay|aigh|ar)/i,'A'],
 [/^(?:au|aw|augh)/i,'O'],
 [/^(?:er|ir|ur)/i,'E'],
 [/^ea/i,null],
 [/^[aeiou]/i,null],
];

/** Lightweight English spelling heuristic for common vowel patterns. */
function englishVisemes(text){
 const result=[];
 const source=String(text).normalize('NFKC');
 const words=[...source.matchAll(/[a-z]+(?:'[a-z]+)?/gi)];
 const shortEa=new Set(['head','bread','dead','thread','spread','meant','health','wealth','stealth','sweat','threat']);
 for(const wordMatch of words){
  let word=wordMatch[0];
  word=word.toLowerCase();if(word.length>2)word=word.replace(/e$/,'');
  for(let i=0;i<word.length;){
   let match=false;
   for(const [pattern,shape] of englishGroups){const found=word.slice(i).match(pattern);if(!found)continue;
    const letters=found[0];
    if(shape)result.push({index:wordMatch.index+i,viseme:shape});
    else if(letters==='ea'&&shortEa.has(wordMatch[0].toLowerCase()))result.push({index:wordMatch.index+i,viseme:'E'});
    else {const char=letters[0];result.push({index:wordMatch.index+i,viseme:char==='a'?'A':char==='e'?'E':char==='i'?'I':char==='o'?'O':'U'});}
    i+=letters.length;match=true;break;
   }
   if(!match)i++;
  }
 }
 return result;
}

/** Return one approximate A/E/I/O/U sequence for Thai and English text. */
export function mapTextToVisemes(text){
 const source=String(text??'').normalize('NFKC');
 return [...thaiVisemes(source),...englishVisemes(source)].sort((a,b)=>a.index-b.index).map(item=>item.viseme);
}

/**
 * Create a duration-weighted viseme timeline. Each entry selects one vowel;
 * the renderer smooths strength without retaining competing vowel shapes.
 */
export function createVisemeTimeline(text,duration){
 const visemes=mapTextToVisemes(text);
 if(!visemes.length||!Number.isFinite(duration)||duration<=0)return null;
 const weight=v=>(v==='I'||v==='U')?0.8:1;
 const totalWeight=visemes.reduce((sum,v)=>sum+weight(v),0);
 let elapsed=0;
 const entries=visemes.map(viseme=>{const start=elapsed/totalWeight*duration;elapsed+=weight(viseme);return {viseme,start,end:elapsed/totalWeight*duration};});
 return {duration,entries};
}

export function sampleVisemeTimeline(timeline,seconds){
 if(!timeline||!Number.isFinite(seconds)||seconds<0||seconds>=timeline.duration)return null;
 return timeline.entries.find(entry=>seconds>=entry.start&&seconds<entry.end)?.viseme??null;
}

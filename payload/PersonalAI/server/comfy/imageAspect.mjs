/** Explicit aspect ratios outrank a tool's inferred/default dimensions. */
export function requestedAspectDimensions(prompt=''){
 if(/16\s*:\s*9/.test(prompt))return {width:1024,height:576};
 if(/9\s*:\s*16/.test(prompt))return {width:576,height:1024};
 if(/4\s*:\s*3/.test(prompt))return {width:1024,height:768};
 if(/3\s*:\s*4/.test(prompt))return {width:768,height:1024};
 if(/1\s*:\s*1|จัตุรัส|\bsquare\b/i.test(prompt))return {width:768,height:768};
 if(/แนวนอน|\blandscape\b/i.test(prompt))return {width:1024,height:576};
 if(/แนวตั้ง|\bportrait\b/i.test(prompt))return {width:768,height:1024};
}

/** Deterministic, model-independent Chat-only router. Never classify tools or persona as complexity. */
export function routeChatReasoning(mode, text='') {
 const selected=['FAST','AUTO','DEEP'].includes(mode)?mode:'FAST';
 if(selected==='FAST')return {selected,effective:'FAST',reason:'manual-fast'};
 if(selected==='DEEP')return {selected,effective:'DEEP',reason:'manual-deep'};
 // AUTO currently favors quick conversation too. Escalation is an explicit
 // user choice through DEEP, avoiding accidental slowdowns in roleplay.
 void text;
 return {selected,effective:'FAST',reason:'fast-default'};
}

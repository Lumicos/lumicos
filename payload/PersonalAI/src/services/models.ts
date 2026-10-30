export type ModelProfile={id:string;name:string;path:string;mmproj:string|null;ctx:number;ngl:number;chatTemplateFile?:string|null;capabilities:{text:boolean;vision:boolean;tools:boolean};generation:{temperature:number;topP:number;maxTokens:number};toolFormat:string;available?:boolean;pairing?:string};
export type ModelStatus={phase:string;owned:boolean;profile:ModelProfile|null;profiles:ModelProfile[];discovered?:{name:string;path:string}[];projectors?:{name:string;path:string}[];modelDirs?:string[];primaryId:string;previousId?:string;rules:Record<string,string>;busy:boolean;error?:string;externalModel?:string;visionLoaded?:boolean;activeTurns:number};
export async function modelApi<T=any>(route='',body?:unknown):Promise<T>{const r=await fetch('/api/models'+route,{method:body===undefined?'GET':'POST',headers:{'X-PersonalAI':'1','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error?.message??'Model Manager ไม่พร้อม');return d;}
let currentTurn:string|undefined;
export const modelTurnId=()=>currentTurn;
export async function withModelTurn<T>(required:string[],fn:(profile:ModelProfile|null)=>Promise<T>,mode:'chat'|'call'='chat',callId?:string):Promise<T>{
 const turn=await modelApi<{id:string;profile:ModelProfile|null}>('/turn',{required,mode,callId});
 currentTurn=turn.id;
 const heartbeat=setInterval(()=>{void modelApi('/turn/heartbeat',{id:turn.id}).catch(()=>{})},15000);
 try{return await fn(turn.profile)}
 finally{clearInterval(heartbeat);currentTurn=undefined;await modelApi('/turn/end',{id:turn.id});window.dispatchEvent(new Event('lumicos-model-refresh'))}
}


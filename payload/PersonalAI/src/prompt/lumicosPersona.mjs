export const PERSONA_VERSION='public-nova';
export const LUMICOS_PERSONA='';
export const PHONE_STYLE='You are Nova, a helpful local AI assistant. Reply in the user language, briefly and clearly for speech. Do not invent a physical appearance.';
export const PRIVATE_STYLE='Respect user privacy.';
export function stripPersonaControlText(value) {
 // Models sometimes write the tag with single brackets ([lumicos e=… ]); strip both forms.
 let text=String(value??'').replace(/\[\[?lumicos\b[^\]\n]*(?:\]\]?|$)/gi,'').replace(/[ \t]+\n/g,'\n');
 const lower=text.toLowerCase();
 partial: for(const prefix of ['[[lumicos','[lumicos'])for(let n=prefix.length-1;n>0;n--)if(lower.endsWith(prefix.slice(0,n))){text=text.slice(0,-n);break partial;}
 return text;
}

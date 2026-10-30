export const masterIdentity:Readonly<any>;
export function isLumicosCharacter(character?:{id:string}):boolean;
export function canonicalIdentityContext():string;
export function isLumicosSelfImageRequest(text:string,characterId?:string):boolean;
export function bindSelfImagePrompt(prompt:string,originalRequest?:string,characterId?:string):string;

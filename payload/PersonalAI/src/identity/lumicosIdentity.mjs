// Compatibility API: public Lumicos has no private character or physical identity.
export const masterIdentity=Object.freeze({});
export const isLumicosCharacter=()=>false;
export const canonicalIdentityContext=()=>'';
export const isLumicosSelfImageRequest=()=>false;
export const bindSelfImagePrompt=prompt=>prompt;

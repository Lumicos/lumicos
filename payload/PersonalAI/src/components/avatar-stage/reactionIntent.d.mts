export type Emotion='neutral'|'happy'|'gentle'|'sad'|'concerned'|'surprised'|'thinking'|'playful';
export type Gesture='none'|'nod'|'tilt'|'look_aside'|'wave';
export interface ReactionIntent {version:1;emotion:Emotion;intensity:number;gesture:Gesture}
export interface ReactionEvent {conversationId:string;messageId:string;intent:ReactionIntent}
export const EMOTIONS:readonly Emotion[];export const GESTURES:readonly Gesture[];
export const REACTION_CONFIG:Readonly<Record<string,number>>;export const NEUTRAL:Readonly<ReactionIntent>;
export function validateReaction(value:unknown):ReactionIntent;
export function parseReaction(value:unknown):{text:string;intent:ReactionIntent};
export function createReactionFeed(read:()=>Array<{id:string;messages:Array<{id:string;role:string;status?:string;reaction?:ReactionIntent}>}>,accept:(event:ReactionEvent)=>void,cancel:()=>void):{message(conversationId:string,message:{id:string;role:string;status?:string;reaction?:ReactionIntent}):void;reset():void;update():void;dispose():void};

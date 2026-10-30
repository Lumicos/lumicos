import type {ReactionEvent} from './reactionIntent.mjs';
export function observeReactions(callback:(event:ReactionEvent|{cancel:true})=>void):()=>void;
export function publishReaction(event:ReactionEvent):void;
export function cancelReactions():void;

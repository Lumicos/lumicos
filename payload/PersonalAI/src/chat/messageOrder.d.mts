import type {ChatMessage} from '../types';
export function orderConversationMessages(messages:ChatMessage[],replyLinks?:Map<string,string>):ChatMessage[];

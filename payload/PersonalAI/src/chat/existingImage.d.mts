import type { ChatMessage, ImagePart } from '../types';
export function existingImageReply(history: ChatMessage[]): {text: string; images: ImagePart[]} | undefined;

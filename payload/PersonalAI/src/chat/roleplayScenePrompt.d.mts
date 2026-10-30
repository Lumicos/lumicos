export const SCENE_REQUEST_RE: RegExp;
export function cardSection(card: string, titleStart: string): string;
export function latestNarration(text: string, max?: number): string;
export function composeScenePrompt(p: { appearance?: string; card?: string; story?: string; lastReply?: string }): string;

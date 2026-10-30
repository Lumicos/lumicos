export const CLOSENESS_STEPS: number[];
export function computeCloseness(messages: { role: string; parts?: { type: string; text?: string }[]; createdAt?: number }[]): { score: number; level: number; turns: number; days: number };

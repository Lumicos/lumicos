// How close the character and the user are, from how much they have talked in this roleplay.
// score = user turns (not OOC) + 10 for every extra day they came back on.
const DAY = 24 * 3600 * 1000;
export const CLOSENESS_STEPS = [15, 50, 120];
export function computeCloseness(messages) {
  const turns = (messages ?? []).filter(m => m.role === 'user' && !/^\s*[(（[]\s*OOC\b/i.test(partsText(m)) && !/^\s*วาดภาพฉากตอนนี้/.test(partsText(m)));
  const days = new Set(turns.map(m => Math.floor(((m.createdAt ?? 0) + 7 * 3600 * 1000) / DAY)));
  const score = turns.length + 10 * Math.max(0, days.size - 1);
  const level = CLOSENESS_STEPS.filter(s => score >= s).length;
  return { score, level, turns: turns.length, days: days.size };
}
function partsText(m) {
  return (m.parts ?? []).filter(p => p.type === 'text').map(p => p.text ?? '').join('');
}

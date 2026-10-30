// Story notes (story.md) and chat summaries are written by the model under a token limit.

/**
 * Notes that hit the token limit stop in the middle of a bullet: keep only the finished lines.
 * claude-20261024: 5 of 6 roleplay story folds stopped at maxTokens 480 mid-sentence, so story.md never got past
 * the early scene and the newer events (the escort deal, the mountain pass) were never written down.
 */
export function finishedNotes(text: string, finishReason?: string): string {
  const t = String(text ?? '').trim();
  if (finishReason !== 'length') return t;
  const lines = t.split('\n');
  if (lines.length > 1) lines.pop();
  return lines.join('\n').trim();
}

const PINNED = /^\s*[-•*]\s*(?:ข้อเท็จจริง|ฉาก|ค้างอยู่)\s*[:：]/u;

/**
 * Story notes longer than `max` lose their OLDEST event bullets first; the facts, scene and open-threads bullets and
 * the newest events stay. claude-20261024 (round 11): story.md hit the 1,800-character limit at 21 messages (the model
 * does not shorten its notes as asked) and cutting the end dropped the newest events.
 */
export function fitNotes(text: string, max: number): string {
  const t = String(text ?? '').trim();
  if (t.length <= max) return t;
  const lines = t.split('\n').filter((l) => l.trim());
  const pinned = lines.filter((l) => PINNED.test(l));
  const head = pinned.filter((l) => !/ค้างอยู่/u.test(l)), tail = pinned.filter((l) => /ค้างอยู่/u.test(l));
  let room = max - [...head, ...tail].join('\n').length - 1;
  const events: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (PINNED.test(lines[i])) continue;
    if (lines[i].length + 1 > room) break;
    events.unshift(lines[i]);
    room -= lines[i].length + 1;
  }
  return clipLines([...head, ...events, ...tail].join('\n'), max);
}

/** Cuts notes to at most `max` characters at a line end, never in the middle of a bullet. */
export function clipLines(text: string, max: number): string {
  const t = String(text ?? '');
  if (t.length <= max) return t;
  if (t[max] === '\n') return t.slice(0, max).trim();
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf('\n');
  return (at > 0 ? cut.slice(0, at) : cut).trim();
}

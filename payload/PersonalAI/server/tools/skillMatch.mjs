// Picks the saved skill that fits a chat message, so its steps ride along with that turn
// (small models rarely decide on their own to call read_skill first).
// A skill opts in with a "triggers:" line in its SKILL.md front matter: comma-separated words or phrases.
// Thai triggers match anywhere in the message; English triggers match whole words only ("vat" ≠ "private").
const ASCII = /^[\x20-\x7e]+$/;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function triggerHits(text, triggers) {
  const lower = String(text ?? '').toLowerCase();
  return (triggers ?? []).filter((t) => {
    const w = t.toLowerCase();
    return ASCII.test(w) ? new RegExp(`(^|[^a-z0-9])${escape(w)}($|[^a-z0-9])`, 'i').test(lower) : lower.includes(w);
  });
}

/** Best single skill for the message, or null. skills = SkillStore.list() rows ({name, triggers, needs?, hasScript}).
 * A skill with a "needs:" list fires only when the message also mentions one of those words (claude-20261023:
 * world-time needs a place outside Thailand, so "ตอนนี้กี่โมง" alone is answered from the clock in the prompt). */
export function matchSkill(text, skills) {
  let best = null;
  for (const s of skills ?? []) {
    const hits = triggerHits(text, s.triggers);
    if (!hits.length) continue;
    if (s.needs?.length && !triggerHits(text, s.needs).length) continue;
    // "unless:" words mean a more specific skill owns the message ("% ของ" in "คิด VAT 7% ของ 980" is vat-and-discount's).
    if (s.unless?.length && triggerHits(text, s.unless).length) continue;
    const score = hits.length * 100 + hits.reduce((n, h) => n + h.length, 0);
    if (!best || score > best.score) best = { name: s.name, hits, hasScript: !!s.hasScript, exactOutput: !!s.exactOutput, score };
  }
  return best;
}

/** "skills/<name>/script.py" (or the skill's first .py file), or undefined. */
export function skillScriptPath(store, name) {
  const files = store.read(name).files;
  return files.find((f) => f.endsWith('/script.py')) ?? files.find((f) => f.endsWith('.py'));
}

/** The text placed in the turn's context: the skill's own steps plus how to load its script. */
export function buildSkillGuide(store, match, maxChars = 2000) {
  const s = store.read(match.name);
  const body = s.text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  const script = skillScriptPath(store, match.name);
  // 2026-10-22: Gemma often answered "ฉันใช้สกิล … ให้เรียบร้อยแล้ว" without running the script (it did the math itself).
  // 2026-10-23: told to "call run_python with exec(…)", it then ran ONLY the exec line (prints nothing) and guessed the
  // answer - so the note now shows both lines of the code to send.
  const head = `Saved skill "${match.name}" matches this message (it mentions: ${match.hits.join(', ')}).`;
  const how = script
    ? [
      ' If the request really is this task, its script has NOT been run yet. Before answering, make ONE run_python call whose code has both of these lines:',
      `exec(open("${script}", encoding="utf-8").read())`,
      'print(<the right function from the steps below>(<the user\'s own numbers>))',
      'The first line only loads the functions and prints nothing; the second line does the work (the examples in the steps use sample numbers - put in the user\'s). If it shows an error, fix the call and run it again. Answer from the printed output only and copy its numbers and words exactly as printed: never work the numbers out yourself, and never say the skill was used unless run_python printed its result.',
    ].join('\n')
    : ' If the request really is this task, follow these steps instead of working it out from scratch.';
  return [
    `${head}${how}\nGive the user the answer only, without mentioning the skill, its name or its script. If the request is not this task, ignore this note.`,
    body.length > maxChars ? `${body.slice(0, maxChars)}\n[…]` : body,
  ].filter(Boolean).join('\n\n');
}

// Builds the picture prompt for the roleplay "draw the current scene" button from the story itself
// (card appearance + scene + story notes + the latest narration) instead of letting the chat model invent one.
export const SCENE_REQUEST_RE = /^\s*วาดภาพฉากตอนนี้/;

const clean = v => String(v ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();

/** Body of "## <title>…" in the card markdown. */
export function cardSection(card, titleStart) {
  const lines = clean(card).split('\n');
  const at = lines.findIndex(l => l.startsWith('## ') && l.slice(3).trim().startsWith(titleStart));
  if (at < 0) return '';
  const rest = lines.slice(at + 1);
  const end = rest.findIndex(l => l.startsWith('## ') || l.startsWith('# '));
  return (end < 0 ? rest : rest.slice(0, end)).join(' ').replace(/\s+/g, ' ').trim();
}

/** Value after "**Label:**" on one line of the story notes (any bullet depth). */
const storyField = (story, label) => {
  const m = clean(story).match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]+)`, 'i'));
  return m ? m[1].trim() : '';
};

/** Narration (text between *asterisks*) of the latest in-story reply, dialogue removed. */
export function latestNarration(text, max = 420) {
  const parts = [...String(text ?? '').matchAll(/\*([^*]{8,})\*/g)].map(m => m[1].trim());
  return parts.join(' ').replace(/\s+/g, ' ').slice(0, max).trim();
}

export function composeScenePrompt({ appearance = '', card = '', story = '', lastReply = '' }) {
  const look = clean(appearance);
  const scene = cardSection(card, 'ฉาก');
  const where = storyField(story, 'Where/When');
  const items = storyField(story, 'Items/Facts');
  const now = latestNarration(lastReply);
  const bits = [look, where && `Setting: ${where}`, !where && scene && `Setting: ${scene}`, items && `Details: ${items}`, now && `Moment: ${now}`]
    .filter(Boolean);
  if (!bits.length) return '';
  return `${bits.map(b => b.replace(/[.\s]+$/, '')).join('. ')}. Cinematic photo, natural lighting, same setting and outfit as in the story.`.slice(0, 1500);
}

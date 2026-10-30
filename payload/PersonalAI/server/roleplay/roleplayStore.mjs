import fs from 'node:fs';
import path from 'node:path';

/**
 * Per-roleplay files, one folder per conversation: <dataDir>/roleplay/<conversationId>/
 *   card.md  character + scene card. Created once from the character; the user may edit it. Sent every turn.
 *   story.md "story so far". Rewritten by the system after some turns (it reads the current file, so user edits are kept
 *            as input). The user may edit it. Sent every turn.
 *   log.md   full record of the chat. Regenerated from the conversation on every turn (edits/regenerations/deletes are
 *            reflected); do not edit. Not sent as a whole: relevant pieces are searched and attached automatically.
 */
const SAFE_ID = /^[a-zA-Z0-9_-]{1,100}$/;
export const LIMITS = { card: 3000, story: 1800, recall: 1400 };

const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}\n[…ตัดให้พอดี…]` : text);
const clean = value => String(value ?? '').trim();
const textOf = message => (message.parts ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n').trim();

/** `(OOC: …)` at the start of a message: the user talks to Lumicos outside the story. */
export const isOoc = text => /^\s*[(（[]\s*OOC\b/i.test(text ?? '');
/** Messages without OOC notes and the replies to them: the story record (log, story notes) never contains them. */
export function withoutOoc(messages) {
  const skip = new Set(), out = [];
  for (const m of messages) {
    if (m.role === 'user' && isOoc(textOf(m))) { skip.add(m.id); continue; }
    if (m.role === 'assistant' && skip.has(m.replyToId)) continue;
    out.push(m);
  }
  return out;
}

export function cardTemplate(character, userName) {
  const field = (title, value) => (clean(value) ? `## ${title}\n${clean(value)}\n\n` : '');
  return [
    `# การ์ดตัวละคร: ${clean(character.name) || 'ตัวละคร'}`,
    '',
    '<!-- ไฟล์นี้แก้ได้ ระบบส่งให้โมเดลทุกเทิร์น เขียนสั้นและชัด -->',
    '',
    field('ชื่อเล่น', character.nickname),
    field('คำอธิบาย', character.description),
    field('บุคลิก', character.personality),
    field('วิธีพูด', character.speakingStyle),
    field('ความสัมพันธ์กับผู้เล่น', [clean(character.userRelationship), clean(userName) && clean(userName) !== 'User' ? `ผู้เล่นชื่อ ${clean(userName)}` : ''].filter(Boolean).join('\n')),
    field('กฎของตัวละคร', character.behaviorRules),
    field('คำสั่งเพิ่มเติม', character.systemPrompt),
    '## รูปลักษณ์ (ใช้วาดภาพให้หน้าตาคงที่ — เขียนเป็นอังกฤษได้ เช่น "long silver hair, green eyes, black coat")',
    '',
    '## ฉาก (สถานที่ เวลา สถานการณ์เริ่มต้น)',
    '',
  ].join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Body of a "## <title>" section, ignoring HTML comments. Empty when missing. */
export function sectionOf(markdown, titleStart) {
  const text = String(markdown ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const lines = text.split('\n');
  const at = lines.findIndex(l => l.startsWith('## ') && l.slice(3).trim().startsWith(titleStart));
  if (at < 0) return '';
  const rest = lines.slice(at + 1);
  const end = rest.findIndex(l => l.startsWith('## ') || l.startsWith('# '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

const bigrams = text => {
  const t = String(text).toLowerCase().replace(/\s+/g, ' ');
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
};

export class RoleplayStore {
  constructor(dataDir) { this.root = dataDir ? path.join(dataDir, 'roleplay') : null; }
  dir(conversationId) {
    if (!this.root || !SAFE_ID.test(conversationId ?? '')) return null;
    return path.join(this.root, conversationId);
  }
  file(conversationId, name) { const d = this.dir(conversationId); return d && path.join(d, name); }
  read(conversationId, name) {
    try { return fs.readFileSync(this.file(conversationId, name), 'utf8'); } catch { return ''; }
  }
  /** Creates the folder and card.md/story.md when missing. Never overwrites a file the user may have edited. */
  ensure(conversationId, character, userName) {
    const d = this.dir(conversationId);
    if (!d) return false;
    fs.mkdirSync(d, { recursive: true });
    const card = path.join(d, 'card.md');
    if (!fs.existsSync(card)) fs.writeFileSync(card, cardTemplate(character, userName));
    const story = path.join(d, 'story.md');
    if (!fs.existsSync(story)) fs.writeFileSync(story, '# เนื้อเรื่องที่ผ่านมา\n\n<!-- ระบบอัปเดตให้เองหลังคุยไปสักพัก แก้ได้ -->\n');
    return true;
  }
  card(conversationId) { return clip(this.read(conversationId, 'card.md').replace(/<!--[\s\S]*?-->/g, '').trim(), LIMITS.card); }
  appearance(conversationId) { return sectionOf(this.read(conversationId, 'card.md'), 'รูปลักษณ์').slice(0, 600); }
  /** The character's own looks for the per-turn reminder: the appearance section, else the description (claude-20261023). */
  looks(conversationId) { return (this.appearance(conversationId) || sectionOf(this.read(conversationId, 'card.md'), 'คำอธิบาย')).slice(0, 300); }
  story(conversationId) {
    const body = this.read(conversationId, 'story.md').replace(/<!--[\s\S]*?-->/g, '').replace(/^# .*\n?/, '').trim();
    return clip(body, LIMITS.story);
  }
  writeStory(conversationId, bullets) {
    const d = this.dir(conversationId);
    if (!d) return;
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'story.md'), `# เนื้อเรื่องที่ผ่านมา\n\n<!-- ระบบอัปเดตให้เองหลังคุยไปสักพัก แก้ได้ -->\n${bullets.trim()}\n`);
  }
  /** Rewrites log.md from the conversation: one block per message, tagged with its id. */
  writeLog(conversation, characterName, userName) {
    const d = this.dir(conversation.id);
    if (!d) return;
    fs.mkdirSync(d, { recursive: true });
    const blocks = conversation.messages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.status !== 'error' && !m.isGreeting)
      .map(m => ({ id: m.id, who: m.role === 'user' ? (clean(userName) || 'ผู้เล่น') : characterName, text: textOf(m) }))
      .filter(b => b.text);
    const body = blocks.map(b => `<!-- id:${b.id} -->\n**${b.who}:** ${b.text}`).join('\n\n');
    fs.writeFileSync(path.join(d, 'log.md'), `# บันทึกเต็ม (สร้างอัตโนมัติ ห้ามแก้ — ระบบเขียนทับทุกเทิร์น)\n\n${body}\n`);
  }
  /**
   * Pieces of the full log that match the user's latest message, skipping messages already in the prompt.
   * Character bigram overlap works for Thai (no spaces) and for other languages alike.
   */
  recall(conversationId, query, excludeIds = [], { max = 3 } = {}) {
    const log = this.read(conversationId, 'log.md');
    const q = bigrams(query);
    if (!log || q.size < 3) return '';
    const skip = new Set(excludeIds);
    const pieces = [];
    for (const m of log.matchAll(/<!-- id:([\w-]+) -->\n([\s\S]*?)(?=\n\n<!-- id:|\n*$)/g)) {
      if (skip.has(m[1])) continue;
      pieces.push({ id: m[1], text: m[2].trim() });
    }
    const scored = pieces.map((p, order) => {
      const grams = bigrams(p.text);
      let hit = 0;
      for (const g of q) if (grams.has(g)) hit++;
      return { ...p, order, score: hit / Math.sqrt(q.size * Math.max(grams.size, 1)) };
    }).filter(p => p.score >= 0.12).sort((a, b) => b.score - a.score).slice(0, max).sort((a, b) => a.order - b.order);
    if (!scored.length) return '';
    let out = '';
    for (const p of scored) {
      const line = `- ${p.text.replace(/\s+/g, ' ').slice(0, 450)}\n`;
      if (out.length + line.length > LIMITS.recall) break;
      out += line;
    }
    return out.trim();
  }
}

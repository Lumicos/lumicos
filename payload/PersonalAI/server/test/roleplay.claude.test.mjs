import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoleplayStore, cardTemplate, sectionOf, withoutOoc, isOoc } from '../roleplay/roleplayStore.mjs';
import { buildMessages, buildSections, isOocText, DEFAULT_CHARACTER } from '../../.runtime/chat.mjs';

const actor = { id: 'c1', name: 'ลีน่า', description: 'นักดาบพเนจร', personality: 'เงียบ ขรึม', speakingStyle: 'พูดสั้น', userRelationship: 'สหายร่วมทาง', behaviorRules: '- ไม่โกหก', systemPrompt: '', firstMessage: 'สวัสดี' };
const msg = (id, role, text, extra = {}) => ({ id, role, parts: [{ type: 'text', text }], createdAt: 1, status: 'done', ...extra });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rp-'));

test('card.md is created once from the character and never overwritten', () => {
  const dir = tmp(), store = new RoleplayStore(dir);
  assert.equal(store.ensure('chat1', actor, 'ปอ'), true);
  const file = path.join(dir, 'roleplay', 'chat1', 'card.md');
  assert.match(fs.readFileSync(file, 'utf8'), /ลีน่า[\s\S]*นักดาบพเนจร[\s\S]*ผู้เล่นชื่อ ปอ/);
  fs.appendFileSync(file, '\nผู้ใช้เพิ่มเอง\n');
  store.ensure('chat1', { ...actor, description: 'เปลี่ยนแล้ว' }, 'ปอ');
  assert.match(store.card('chat1'), /ผู้ใช้เพิ่มเอง/);
  assert.doesNotMatch(store.card('chat1'), /เปลี่ยนแล้ว/);
});

test('unsafe conversation ids never reach the file system', () => {
  const dir = tmp(), store = new RoleplayStore(dir);
  assert.equal(store.ensure('../escape', actor, 'x'), false);
  assert.equal(new RoleplayStore(undefined).ensure('chat1', actor, 'x'), false);
  assert.equal(fs.existsSync(path.join(dir, 'escape')), false);
});

test('appearance line comes from the card section', () => {
  const dir = tmp(), store = new RoleplayStore(dir);
  store.ensure('chat1', actor, 'ปอ');
  const file = path.join(dir, 'roleplay', 'chat1', 'card.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/(## รูปลักษณ์[^\n]*\n)/, '$1long silver hair, green eyes, black coat\n'));
  assert.equal(store.appearance('chat1'), 'long silver hair, green eyes, black coat');
  assert.equal(sectionOf(cardTemplate(actor, 'ปอ'), 'ฉาก'), '');
});

test('OOC notes and their replies stay out of the record', () => {
  const list = [msg('u1', 'user', 'ลีน่าเดินเข้าเมือง'), msg('a1', 'assistant', 'เธอเงยหน้ามอง', { replyToId: 'u1' }),
    msg('u2', 'user', '(OOC: ขอเปลี่ยนฉากได้ไหม)'), msg('a2', 'assistant', 'ได้ค่ะ', { replyToId: 'u2' }), msg('u3', 'user', 'เดินต่อ')];
  assert.deepEqual(withoutOoc(list).map(m => m.id), ['u1', 'a1', 'u3']);
  assert.equal(isOoc('  (OOC: x)'), true);
  assert.equal(isOoc('ooc คืออะไร'), false);
  assert.equal(isOocText('[OOC พักก่อน]'), true);
});

test('log.md is rebuilt from the conversation; recall finds old pieces and skips ones already in the prompt', () => {
  const dir = tmp(), store = new RoleplayStore(dir);
  store.ensure('chat1', actor, 'ปอ');
  const messages = [msg('g', 'assistant', 'สวัสดี', { isGreeting: true }), msg('u1', 'user', 'ฉันซ่อนกุญแจทองไว้ใต้ต้นไม้ใหญ่หลังวัด'), msg('a1', 'assistant', 'ลีน่าพยักหน้า จำที่ซ่อนกุญแจทองไว้', { replyToId: 'u1' }),
    msg('u2', 'user', 'เราออกเดินทางไปทางเหนือ'), msg('a2', 'assistant', 'ลมหนาวพัดแรงขึ้น', { replyToId: 'u2' })];
  store.writeLog({ id: 'chat1', messages }, 'ลีน่า', 'ปอ');
  const log = fs.readFileSync(path.join(dir, 'roleplay', 'chat1', 'log.md'), 'utf8');
  assert.doesNotMatch(log, /สวัสดี/);
  assert.match(log, /<!-- id:u1 -->\n\*\*ปอ:\*\* ฉันซ่อนกุญแจทอง/);
  const hit = store.recall('chat1', 'กุญแจทองที่ซ่อนไว้อยู่ที่ไหนนะ', ['a2']);
  assert.match(hit, /กุญแจทอง/);
  assert.equal(store.recall('chat1', 'กุญแจทองที่ซ่อนไว้อยู่ที่ไหนนะ', ['u1', 'a1', 'u2', 'a2']), '');
  assert.equal(store.recall('chat1', 'ขอบคุณ', []), '');
});

test('story.md is rewritten and read back without its header', () => {
  const dir = tmp(), store = new RoleplayStore(dir);
  store.ensure('chat1', actor, 'ปอ');
  assert.equal(store.story('chat1'), '');
  store.writeStory('chat1', '- ลีน่าพบปอที่หน้าวัด\n- ปอฝากกุญแจทอง');
  assert.equal(store.story('chat1'), '- ลีน่าพบปอที่หน้าวัด\n- ปอฝากกุญแจทอง');
});

const history = (text) => [msg('u1', 'user', text)];
const rp = { characterName: 'ลีน่า', card: '# การ์ด\nนักดาบพเนจร', story: '- เดินทางมาถึงเมือง', recall: '- ปอ: ซ่อนกุญแจทอง' };

test('roleplay prompt: character card + rules in the system prompt, story/recall with the turn; no Lumicos persona, global prompt or memory', () => {
  const { messages } = buildMessages({ globalPrompt: 'You are a local personal AI assistant.', character: DEFAULT_CHARACTER, userName: 'ปอ', greetingMode: 'context-note',
    history: history('ลีน่า เธออยู่ไหน'), roleplay: rp, memories: [{ id: 'm', type: 'fact', content: 'ชอบกาแฟ', score: 1, reason: '' }] });
  const system = messages[0].content;
  assert.match(system, /You are playing ลีน่า/);
  assert.match(system, /นักดาบพเนจร/);
  assert.doesNotMatch(system, /Lumicos Persona|Canonical Self Identity|local personal AI assistant/);
  const last = messages.at(-1).content;
  assert.match(last, /Story So Far[\s\S]*เดินทางมาถึงเมือง/);
  assert.match(last, /ซ่อนกุญแจทอง/);
  assert.doesNotMatch(system, /เดินทางมาถึงเมือง/, 'volatile parts stay out of the cached system prompt');
});

test('roleplay prompt: an OOC turn tells the model to step out of the story', () => {
  const ooc = buildSections({ globalPrompt: '', character: actor, userName: 'ปอ', greetingMode: 'context-note', roleplay: { ...rp, ooc: true } });
  assert.ok(ooc.some(s => s.id === 'roleplay-turn' && /out of character/i.test(s.content)));
  const normal = buildSections({ globalPrompt: '', character: actor, userName: 'ปอ', greetingMode: 'context-note', roleplay: rp });
  assert.ok(!normal.some(s => s.id === 'roleplay-turn'));
});

test('assistant prompt is unchanged by the roleplay feature', () => {
  const sections = buildSections({ globalPrompt: 'G', character: DEFAULT_CHARACTER, userName: 'ปอ', greetingMode: 'context-note' });
  assert.ok(sections.some(s => s.id === 'persona') && sections.some(s => s.id === 'global'));
  assert.ok(!sections.some(s => s.id.startsWith('roleplay')));
});

test('tight budget drops recall first, then the story, never the card', () => {
  const big = { ...rp, recall: '- ' + 'ก'.repeat(1200), story: '- ' + 'ข'.repeat(1500), card: 'การ์ด ' + 'ค'.repeat(800) };
  const { messages, info } = buildMessages({ globalPrompt: '', character: actor, userName: 'ปอ', greetingMode: 'context-note', history: history('สวัสดี'), roleplay: big,
    budget: { contextTokens: 900, replyTokens: 200 } });
  assert.ok(info.droppedContext?.[0] === 'roleplay-recall');
  assert.match(messages[0].content, /การ์ด/);
});

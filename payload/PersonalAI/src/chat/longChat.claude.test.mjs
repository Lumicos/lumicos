// claude-20261023: the 56-check Real Chat Check found, in a 20-message roleplay, replies copied word for word from
// 8 turns back (the kept window started with an assistant reply whose question was cut), replies of 700–820
// characters for one-line questions, and the character's own scar placed on the player.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compactContext, buildMessages, overlap, repeatsEarlierReply, formatLimitRule, foldStory, DEFAULT_ASSISTANT } from '../../.runtime/chat.mjs';

const msg = (i, role, text) => ({ id: `m${i}`, role, parts: [{ type: 'text', text }], createdAt: i, status: 'done' });
const chat = (n) => Array.from({ length: n }, (_, i) => msg(i, i % 2 ? 'assistant' : 'user', i % 2 ? `คำตอบที่ ${(i + 1) / 2} ${'ก'.repeat(30)}` : `คำถามที่ ${i / 2 + 1}`));
const conv = { id: 'c', title: 't', messages: [], createdAt: 1, updatedAt: 1 };

test('the kept window always starts with a user message (21 and 39 messages)', () => {
  for (const n of [17, 21, 39]) {
    const c = compactContext(conv, chat(n));
    assert.equal(c.history[0].role, 'user', `${n} messages`);
    assert.equal(c.history.at(-1).id, `m${n - 1}`, 'the latest message is kept');
    assert.ok(c.history.length <= 16);
    const dropped = chat(n).slice(0, n - c.history.length).at(-1);
    assert.ok(c.summary.includes(dropped.parts[0].text.slice(0, 20)), 'the reply left out goes into the raw summary');
  }
  assert.equal(compactContext(conv, chat(15)).history.length, 15, 'short chats are untouched');
});

test('a history that starts with a reply (not a greeting) is sent starting with the user', () => {
  const history = [msg(1, 'assistant', 'คำตอบเก่าที่คำถามถูกตัดไป'), msg(2, 'user', 'คำถามใหม่'), msg(3, 'assistant', 'ตอบ'), msg(4, 'user', 'ล่าสุด')];
  const base = { globalPrompt: '', character: DEFAULT_ASSISTANT, userName: 'U', greetingMode: 'none', history };
  const m = buildMessages(base).messages;
  assert.equal(m[1].role, 'user');
  assert.ok(!JSON.stringify(m).includes('คำตอบเก่าที่คำถามถูกตัดไป'));
  const greeting = [{ ...msg(0, 'assistant', 'สวัสดี ข้าคือมิร่า'), isGreeting: true }, msg(2, 'user', 'สวัสดี')];
  const g = buildMessages({ ...base, greetingMode: 'assistant-turn', history: greeting }).messages;
  assert.equal(g[1].role, 'assistant', "an 'assistant-turn' greeting stays first");
});

test('repeat guard: copies of an earlier reply are caught, different replies are not', () => {
  const old = '*มิร่ามองตามที่คุณกำลังจิบซุปอย่างเอร็ดอร่อย ดวงตาของเธอดูผ่อนคลายลงเล็กน้อยเมื่อเห็นคุณมีความสุขกับอาหาร* "อร่อย" *เธอพยักหน้า รับคำชมอย่างเรียบ ๆ* "มันก็พอใช้ได้สำหรับซุปเห็ดในคืนฝนตก"';
  const other = '*มิร่าเลิกคิ้วขึ้นเล็กน้อยเมื่อได้ยินคำถามเรื่องค่าจ้าง ดวงตาสีเขียวเป็นประกาย* "สามเหรียญเงินน้อยไปสำหรับช่องเขานั่น ข้าขอห้าเหรียญ ไม่ต่อรอง" *เธอวางแก้วไวน์ลงบนโต๊ะ*';
  const history = [msg(1, 'user', 'อร่อยดีแฮะ'), msg(2, 'assistant', old), msg(3, 'user', 'ค่าจ้างเท่าไหร่')];
  assert.ok(overlap(old, old.replace('อร่อย"', 'อร่อยนะ"')) > 0.9);
  assert.ok(overlap(old, other) < 0.2);
  assert.equal(repeatsEarlierReply(old, history, 'เมื่อกี้ข้าสั่งอะไรมากินนะ'), true);
  assert.equal(repeatsEarlierReply(other, history, 'สามเหรียญเงินพอไหม'), false);
  assert.equal(repeatsEarlierReply(old, history, 'พูดอีกทีได้ไหม'), false, 'asking for it again is fine');
  assert.equal(repeatsEarlierReply('สั้น', history, 'x'), false, 'very short replies are not checked');
});

test('explicit format limits become a rule in the reply-length context', () => {
  assert.match(formatLimitRule('ขอสูตรไข่เจียวแบบสั้น ๆ ไม่เกิน 3 บรรทัด'), /at most 3 บรรทัด.*no lead-in line/);
  assert.match(formatLimitRule('ตอบสั้น ๆ คำเดียวพอ ท้องฟ้าสีอะไร'), /"คำเดียว"/);
  assert.match(formatLimitRule('ขอสองข้อพอ'), /at most 2 ข้อ/);
  assert.match(formatLimitRule('สรุปไม่เกินสามประโยค'), /at most 3 ประโยค/);
  assert.equal(formatLimitRule('กาแฟกับชาเขียว อันไหนคาเฟอีนเยอะกว่า'), '');
  const base = { globalPrompt: '', character: DEFAULT_ASSISTANT, userName: 'U', greetingMode: 'none', history: [msg(1, 'user', 'ขอสูตรไข่เจียว ไม่เกิน 3 บรรทัด')] };
  const m = buildMessages({ ...base, formatRule: formatLimitRule('ไม่เกิน 3 บรรทัด') }).messages;
  assert.ok(m.at(-1).content.includes('at most 3 บรรทัด') && !m[0].content.includes('at most 3'), 'per turn, never in the cached system prompt');
});

test('roleplay turn note: own looks, length from the player line, no copying; none out of character', () => {
  const history = [msg(1, 'user', 'ไม่เหงาบ้างเหรอ')];
  const base = { globalPrompt: '', character: DEFAULT_ASSISTANT, userName: 'U', greetingMode: 'none', history };
  const rp = { characterName: 'มิร่า', card: 'มิร่า นักดาบ', looks: 'ผมสั้นสีน้ำตาลเข้ม ตาสีเขียว แผลเป็นเล็กที่คิ้วซ้าย', playerChars: 15 };
  const short = buildMessages({ ...base, roleplay: rp }).messages;
  assert.match(short.at(-1).content, /ลักษณะเหล่านี้เป็นของมิร่าเอง ไม่ใช่ของผู้เล่น: ผมสั้น/);
  assert.match(short.at(-1).content, /1–3 ประโยค/);
  assert.match(short.at(-1).content, /ห้ามคัดลอกหรือพูดซ้ำคำตอบเก่าของมิร่า/);
  assert.ok(!short[0].content.includes('ลักษณะเหล่านี้'), 'not in the cached system prompt');
  assert.match(buildMessages({ ...base, roleplay: { ...rp, playerChars: 200 } }).messages.at(-1).content, /ไม่เกิน 2 ย่อหน้าสั้น/);
  assert.ok(!buildMessages({ ...base, roleplay: { ...rp, ooc: true } }).messages.at(-1).content.includes('ลักษณะเหล่านี้'));
  assert.match(buildMessages({ ...base, roleplay: rp, retryNote: 'RETRY-NOTE' }).messages.at(-1).content, /RETRY-NOTE/);
});

test('roleplay: "ข้า" in a player line means the player; story notes keep a never-dropped facts bullet', async () => {
  const base = { globalPrompt: '', character: DEFAULT_ASSISTANT, userName: 'U', greetingMode: 'none', history: [msg(1, 'user', 'ข้ามาจากที่ไหนนะ')] };
  const m = buildMessages({ ...base, roleplay: { characterName: 'มิร่า', card: 'มิร่า', playerChars: 16 } }).messages;
  assert.match(m.at(-1).content, /"ข้า" "ฉัน" "ผม" "เรา" ในข้อความของผู้เล่นหมายถึงตัวผู้เล่นเอง ไม่ใช่มิร่า/);
  let system = '';
  const provider = { async streamChat(request, cb) { system = request.messages[0].content; cb.onToken('- ข้อเท็จจริง: ต้น พ่อค้าจากเมืองท่าทางใต้; ต้นสั่งซุปเห็ดกับชาขิง\n- ต้นเข้ามาในโรงเตี๊ยม'); cb.onDone({ stopped: false }); } };
  const out = await foldStory(provider, '', [msg(1, 'user', 'ข้าชื่อต้น มาจากเมืองท่าทางใต้')], { character: 'มิร่า', user: 'ต้น' }, new AbortController().signal);
  assert.match(system, /Begin with one bullet "- ข้อเท็จจริง: …"/);
  assert.match(system, /never drop or change an old fact/);
  assert.match(system, /ต้น is the user's character, มิร่า is the other character/);
  assert.match(out, /ข้อเท็จจริง/);
});

// claude-20261024: Real Chat Check round 10 — 5 of 6 roleplay story folds stopped at the 480-token limit in the
// middle of a bullet, so story.md never got past the early scene (the escort deal and the mountain pass were never
// written down). Notes now get room for Thai, ask for a compact shape, and keep only finished lines when cut off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { finishedNotes, clipLines, fitNotes, foldStory, foldContext } from '../../.runtime/chat.mjs';

const msg = (i, role, text) => ({ id: `m${i}`, role, parts: [{ type: 'text', text }], createdAt: i, status: 'done' });
const signal = new AbortController().signal;
/** Fake model: records the request, streams `text`, ends with `finishReason`. */
const fake = (text, finishReason) => {
  const seen = {};
  return { seen, async streamChat(request, cb) { seen.request = request; cb.onToken(text); cb.onDone({ stopped: false, finishReason }); } };
};

test('notes cut off by the token limit keep only their finished lines', () => {
  const cut = '- ข้อเท็จจริง: ต้น พ่อค้าจากเมืองท่าทางใต้\n- ต้นจ้างมิร่าคุ้มกัน สามเหรียญเงิน\n- มิร่าตอบว่าดาบได้มาจากการต่อสู้, ประชดเรื่องความใหม่ของ';
  assert.equal(finishedNotes(cut, 'length'), '- ข้อเท็จจริง: ต้น พ่อค้าจากเมืองท่าทางใต้\n- ต้นจ้างมิร่าคุ้มกัน สามเหรียญเงิน');
  assert.equal(finishedNotes(cut, 'stop'), cut, 'a finished answer is kept whole');
  assert.equal(finishedNotes(cut), cut, 'unknown finish reason: kept whole');
  assert.equal(finishedNotes('- บรรทัดเดียว', 'length'), '- บรรทัดเดียว', 'a single line is kept rather than dropping everything');
});

test('clipping notes to a size cuts at a line end, never mid-bullet', () => {
  const notes = '- หนึ่ง\n- สอง สอง\n- สาม สาม สาม';
  assert.equal(clipLines(notes, 100), notes);
  assert.equal(clipLines(notes, 14), '- หนึ่ง', 'the second bullet would be cut: dropped');
  assert.equal(clipLines(notes, 17), '- หนึ่ง\n- สอง สอง', 'the cut falls exactly at a line end: kept');
  assert.equal(clipLines('ไม่มีขึ้นบรรทัดเลย'.repeat(3), 10).length, 10);
});

test('story notes over the limit lose the oldest events first; facts, scene, open threads and the newest events stay', () => {
  const facts = '- ข้อเท็จจริง: ต้น: พ่อค้าจากเมืองท่าทางใต้ | มิร่า: นักดาบ';
  const scene = '- ฉาก: โรงเตี๊ยม คืนฝนตก';
  const events = Array.from({ length: 30 }, (_, i) => `- เหตุการณ์ที่ ${i + 1} ${'ก'.repeat(40)}`);
  const open = '- ค้างอยู่: ออกเดินทางตอนรุ่งสาง';
  const out = fitNotes([facts, scene, ...events, open].join('\n'), 800);
  assert.ok(out.length <= 800, `length ${out.length}`);
  const lines = out.split('\n');
  assert.equal(lines[0], facts);
  assert.equal(lines[1], scene);
  assert.equal(lines.at(-1), open, 'open threads stay last');
  assert.equal(lines.at(-2), events.at(-1), 'the newest event stays');
  assert.ok(!out.includes('เหตุการณ์ที่ 1 '), 'the oldest event goes first');
  const kept = lines.slice(2, -1).map((l) => Number(l.match(/ที่ (\d+)/)[1]));
  assert.deepEqual(kept, [...kept].sort((a, b) => a - b), 'kept events stay in order');
  assert.equal(fitNotes('- สั้น', 800), '- สั้น', 'short notes are untouched');
});

test('story notes: room for Thai, a compact shape that keeps the newest events, finished lines only', async () => {
  const model = fake('- ข้อเท็จจริง: ต้น: พ่อค้า มาจากเมืองท่าทางใต้ | มิร่า: นักดาบ\n- ฉาก: โรงเตี๊ยม คืนฝนตก\n- ต้นเสนอค่าจ้างสามเหรียญเงิน\n- ค้างอยู่: ออกเดินทางตอนรุ่งส', 'length');
  const out = await foldStory(model, '', [msg(1, 'user', 'สามเหรียญเงินพอไหม')], { character: 'มิร่า', user: 'ต้น' }, signal);
  assert.ok(model.seen.request.params.maxTokens >= 900, `maxTokens ${model.seen.request.params.maxTokens}`);
  const system = model.seen.request.messages[0].content;
  assert.match(system, /merge the oldest events into one bullet instead of dropping the newest/);
  assert.match(system, /- ค้างอยู่: …/);
  assert.match(system, /under 1,200 characters/);
  assert.match(system, /Begin with one bullet "- ข้อเท็จจริง: …"/, 'the facts bullet stays');
  assert.ok(out.endsWith('- ต้นเสนอค่าจ้างสามเหรียญเงิน'), out);
  const long = fake(['- ข้อเท็จจริง: ต้น พ่อค้า', ...Array.from({ length: 60 }, (_, i) => `- เหตุการณ์ที่ ${i + 1} ${'ข'.repeat(30)}`)].join('\n'), 'stop');
  const fitted = await foldStory(long, '', [msg(1, 'user', 'x')], { character: 'มิร่า', user: 'ต้น' }, signal);
  assert.ok(fitted.length <= 1800 && fitted.startsWith('- ข้อเท็จจริง') && fitted.endsWith(`- เหตุการณ์ที่ 60 ${'ข'.repeat(30)}`), 'written notes keep facts + newest');
});

test('chat summaries get the same room and the same cut-off handling', async () => {
  const model = fake('- ผู้ใช้ถามราคาทอง\n- ผู้ใช้ชื่อต้น\n- Lumicos บอกว่าราคาทองวันนี้ 64,1', 'length');
  const out = await foldContext(model, '', [msg(1, 'user', 'ราคาทองวันนี้เท่าไหร่')], signal);
  assert.ok(model.seen.request.params.maxTokens >= 900);
  assert.match(model.seen.request.messages[0].content, /under 1,200 characters/);
  assert.equal(out, '- ผู้ใช้ถามราคาทอง\n- ผู้ใช้ชื่อต้น');
});

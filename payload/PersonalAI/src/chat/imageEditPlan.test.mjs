import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editMode, padFromText, planImageEdit } from './imageEditPlan.ts';
const sig = () => new AbortController().signal;
const fake = reply => ({ streamChat: async (r, cb) => { fake.req = r; cb.onToken(reply); cb.onDone({ stopped: false }); } });

test('editMode recognises extend vs add/remove requests and ignores ordinary image asks', () => {
  assert.equal(editMode('ขยายภาพไปทางซ้ายและขวา'), 'outpaint');
  assert.equal(editMode('extend the image to the right'), 'outpaint');
  assert.equal(editMode('เติมเฟอร์นิเจอร์ในห้องว่างนี้'), 'inpaint');
  assert.equal(editMode('ใส่โซฟาตรงกลางห้อง'), 'inpaint');
  assert.equal(editMode('วาดแมวสีขาวนอนบนโซฟา'), undefined);
  assert.equal(editMode('ทำให้ภาพนี้เป็นสไตล์อนิเมะ'), undefined);
});
test('padFromText reads sides and percent', () => {
  assert.deepEqual(padFromText('ขยายซ้ายขวา 40%'), { left: 0.4, top: 0, right: 0.4, bottom: 0 });
  assert.deepEqual(padFromText('ขยายทุกด้าน'), { left: 0.3, top: 0.3, right: 0.3, bottom: 0.3 });
  assert.deepEqual(padFromText('extend upward'), { left: 0, top: 0.3, right: 0, bottom: 0 });
  assert.equal(padFromText('ขยายภาพ'), undefined);
});
test('outpaint: text rules win over the model, model only supplies the prompt', async () => {
  const out = await planImageEdit(fake('{"mode":"inpaint","pad":{"left":0.9},"prompt":"A wide bedroom with a window and a wooden floor, soft daylight."}'), { imageDataUrl: 'data:image/png;base64,AA==', instruction: 'ขยายภาพไปทางขวา 25%', signal: sig() });
  assert.deepEqual(out.edit, { mode: 'outpaint', pad: { left: 0, top: 0, right: 0.25, bottom: 0 } });
  assert.match(out.prompt, /wide bedroom/);
  assert.ok(fake.req.messages[1].content.some(p => p.type === 'image_url'));
  assert.equal(fake.req.enableThinking, false);
});
test('inpaint: box comes from the model, is ordered and clamped', async () => {
  const out = await planImageEdit(fake('```json\n{"mode":"inpaint","box":[0.9,1.2,0.1,0.5],"prompt":"A furnished living room with a grey sofa and a rug, daylight."}\n```'), { imageDataUrl: 'data:,', instruction: 'เติมเฟอร์นิเจอร์ให้ห้องว่างนี้', signal: sig() });
  assert.deepEqual(out.edit, { mode: 'inpaint', box: [0.1, 0.5, 0.9, 1] });
});
test('honest failures: no JSON, no box, tiny box, unclear request', async () => {
  const base = { imageDataUrl: 'data:,', signal: sig() };
  await assert.rejects(planImageEdit(fake('ขอโทษ ทำไม่ได้'), { ...base, instruction: 'ใส่โซฟา' }), /สรุปแผน/);
  await assert.rejects(planImageEdit(fake('{"mode":"inpaint","prompt":"A room with a sofa and a lamp."}'), { ...base, instruction: 'ใส่โซฟาในห้อง' }), /หาพื้นที่/);
  await assert.rejects(planImageEdit(fake('{"mode":"inpaint","box":[0.1,0.1,0.15,0.15]}'), { ...base, instruction: 'ใส่โซฟาในห้อง' }), /เล็กเกินไป/);
  await assert.rejects(planImageEdit(fake('{"mode":"outpaint","prompt":"A room with a window and a lamp."}'), { ...base, instruction: 'ขยายภาพ' }), /ด้านไหน/);
});

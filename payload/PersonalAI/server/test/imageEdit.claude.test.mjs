// claude-20261016: Edit Image geometry, masks and graph filling.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeEdit, maskCoverage, planGeometry, renderEditInputs, editEditGraph, EDIT_PATCH_FILE } from '../comfy/imageEdit.mjs';

const png = async (w, h, color = '#c08040') => { const { createCanvas } = await import('@napi-rs/canvas'); const c = createCanvas(w, h), x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); return c.toBuffer('image/png'); };
const px = async (buf, x, y) => { const { loadImage, createCanvas } = await import('@napi-rs/canvas'); const i = await loadImage(buf), c = createCanvas(i.width, i.height), g = c.getContext('2d'); g.drawImage(i, 0, 0); return [...g.getImageData(x, y, 1, 1).data]; };

test('normalizeEdit validates both modes', () => {
  assert.deepEqual(normalizeEdit({ mode: 'outpaint', pad: { left: 0.25, right: 0.25 } }).pad, { left: 0.25, top: 0, right: 0.25, bottom: 0 });
  assert.throws(() => normalizeEdit({ mode: 'outpaint', pad: { left: 0.01 } }), /5%/);
  assert.throws(() => normalizeEdit({ mode: 'outpaint', pad: { left: 2 } }), /100%/);
  assert.throws(() => normalizeEdit({ mode: 'outpaint', pad: { left: 1, right: 1 } }), /มากเกินไป/);
  assert.deepEqual(normalizeEdit({ mode: 'inpaint', box: [0.1, 0.5, 0.9, 1] }).box, [0.1, 0.5, 0.9, 1]);
  assert.throws(() => normalizeEdit({ mode: 'inpaint', box: [0.1, 0.1, 0.12, 0.12] }), /เล็กเกินไป/);
  assert.throws(() => normalizeEdit({ mode: 'inpaint', box: [0, 0, 2, 1] }));
  assert.throws(() => normalizeEdit({ mode: 'spin' }));
});
test('planGeometry keeps multiples of 16, stays in budget, places source flush on untouched sides', () => {
  const g = planGeometry({ width: 832, height: 1216 }, normalizeEdit({ mode: 'outpaint', pad: { left: 0.5, right: 0.5 } }), 720 ** 2);
  assert.ok(g.width % 16 === 0 && g.height % 16 === 0 && g.width * g.height <= 720 ** 2 * 1.08);
  assert.ok(g.src.x > 0 && g.src.x + g.src.w < g.width);
  const down = planGeometry({ width: 1000, height: 600 }, normalizeEdit({ mode: 'outpaint', pad: { bottom: 0.5 } }), 720 ** 2);
  assert.equal(down.src.y, 0); assert.ok(down.src.y + down.src.h < down.height);
  const ip = planGeometry({ width: 1600, height: 1200 }, normalizeEdit({ mode: 'inpaint', box: [0.2, 0.4, 0.8, 1] }), 720 ** 2);
  assert.ok(ip.width <= 1536 && ip.width % 16 === 0 && ip.height % 16 === 0);
});
test('outpaint masks: new border is white (edit), source is black (keep); soft mask feathers the seam', async () => {
  const bytes = await png(400, 300);
  const r = await renderEditInputs(bytes, { width: 400, height: 300 }, normalizeEdit({ mode: 'outpaint', pad: { right: 0.5 } }), 300 * 300);
  const { width: W, height: H, src } = r.geometry;
  assert.equal(src.x, 0);
  assert.equal((await px(r.maskHard, W - 3, Math.floor(H / 2)))[0], 255);
  assert.equal((await px(r.maskHard, 5, src.y + 40))[0], 0);
  assert.equal((await px(r.maskSoft, W - 3, Math.floor(H / 2)))[0], 255);
  assert.equal((await px(r.maskSoft, 5, src.y + 40))[0], 0);
  const seam = (await px(r.maskSoft, src.w, Math.floor(H / 2)))[0];
  assert.ok(seam > 20 && seam < 250, 'seam is feathered: ' + seam);
  const border = await px(r.image, W - 3, Math.floor(H / 2));
  assert.ok(border[0] > 150 && border[2] < 120, 'border continues the source colour, not flat grey: ' + border);
});
test('inpaint masks: white only inside the box', async () => {
  const bytes = await png(400, 300);
  const r = await renderEditInputs(bytes, { width: 400, height: 300 }, normalizeEdit({ mode: 'inpaint', box: [0.25, 0.5, 0.75, 1] }), 300 * 300);
  const { width: W, height: H } = r.geometry;
  assert.equal((await px(r.maskHard, Math.floor(W / 2), Math.floor(H * 0.8)))[0], 255);
  assert.equal((await px(r.maskHard, Math.floor(W / 2), Math.floor(H * 0.2)))[0], 0);
  assert.equal((await px(r.maskHard, 2, Math.floor(H * 0.8)))[0], 0);
});
test('editEditGraph fills the template; the shipped template wires the Fun ControlNet inpaint path', () => {
  const g = JSON.parse(fs.readFileSync(new URL('../comfy/zimage-edit.json', import.meta.url), 'utf8'));
  editEditGraph(g, { prompt: 'a furnished room', width: 704, height: 960, seed: 7, id: 'job1' }, { image: 'Lumicos/a.png', maskHard: 'Lumicos/b.png', maskSoft: 'Lumicos/c.png' });
  assert.equal(g['30'].inputs.name, EDIT_PATCH_FILE);
  assert.deepEqual([g['6'].inputs.width, g['6'].inputs.height, g['7'].inputs.seed], [704, 960, 7]);
  assert.equal(g['22'].class_type, 'ZImageFunControlnet');
  assert.deepEqual(g['22'].inputs.model, ['14', 0]); assert.deepEqual(g['7'].inputs.model, ['22', 0]);
  assert.deepEqual(g['22'].inputs.inpaint_image, ['20', 0]); assert.deepEqual(g['22'].inputs.mask, ['21', 0]);
  assert.deepEqual(g['10'].inputs.images, ['24', 0]); assert.deepEqual(g['24'].inputs.mask, ['23', 0]);
  assert.equal(g['7'].inputs.denoise, 1);
});

test('painted mask: accepted by id, white only where painted (grown slightly), coverage measured', async () => {
  const { createCanvas } = await import('@napi-rs/canvas');
  const m = createCanvas(400, 300), x = m.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 400, 300); x.fillStyle = '#fff'; x.beginPath(); x.arc(300, 150, 40, 0, 7); x.fill();
  const maskBytes = m.toBuffer('image/png');
  const id = '11111111-2222-3333-4444-555555555555';
  assert.deepEqual(normalizeEdit({ mode: 'inpaint', maskId: id }), { mode: 'inpaint', maskId: id });
  assert.throws(() => normalizeEdit({ mode: 'inpaint', maskId: '../x' }), /มาสก์/);
  const cover = await maskCoverage(maskBytes);
  assert.ok(cover > 0.03 && cover < 0.06, 'circle of r=40 in 400x300 is ~4%: ' + cover);
  const r = await renderEditInputs(await png(400, 300), { width: 400, height: 300 }, normalizeEdit({ mode: 'inpaint', maskId: id }), 300 * 300, maskBytes);
  const { width: W, height: H } = r.geometry;
  assert.equal((await px(r.maskHard, Math.round(W * 0.75), Math.round(H * 0.5)))[0], 255);
  assert.equal((await px(r.maskHard, Math.round(W * 0.2), Math.round(H * 0.5)))[0], 0);
  const src = await png(400, 300);
  await assert.rejects(() => renderEditInputs(src, { width: 400, height: 300 }, { mode: 'inpaint', maskId: id }, 300 * 300), /มาสก์/);
});

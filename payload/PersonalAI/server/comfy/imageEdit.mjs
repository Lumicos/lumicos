// Edit Image: outpaint (extend the canvas on any side) and inpaint (regenerate one region, e.g. furnish an empty room).
// Both use Z-Image Turbo + the Z-Image-Turbo-Fun-Controlnet-Union-2.1 "lite" patch (inpaint_image + mask).
// All pixel work (placing the source, building masks) happens here with @napi-rs/canvas, so the ComfyUI graph stays tiny.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const EDIT_PATCH_FILE = 'Z-Image-Turbo-Fun-Controlnet-Union-2.1-lite-2602-8steps.safetensors';
export const EDIT_PATCH_DIR = fileURLToPath(new URL('../../../ComfyUI-Next/models/model_patches/', import.meta.url));
const SIDES = ['left', 'top', 'right', 'bottom'];
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const r16 = n => Math.max(256, Math.round(n / 16) * 16);

/** Validates an edit request. pad values are fractions of the source size (0.5 = add half the width/height). */
export function normalizeEdit(edit) {
  if (!edit || typeof edit !== 'object') throw fail('คำสั่งแก้ภาพไม่ถูกต้อง');
  if (edit.mode === 'outpaint') {
    const pad = {};
    for (const s of SIDES) {
      const v = edit.pad?.[s] === undefined ? 0 : num(edit.pad[s]);
      if (v === undefined || v < 0 || v > 1) throw fail('ขยายขอบได้ครั้งละไม่เกิน 100% ของภาพต่อด้าน');
      pad[s] = Math.round(v * 1000) / 1000;
    }
    if (pad.left + pad.right > 1.5 || pad.top + pad.bottom > 1.5) throw fail('ขยายรวมกันมากเกินไป ลองขยายทีละน้อย');
    if (!SIDES.some(s => pad[s] >= 0.05)) throw fail('ต้องขยายอย่างน้อยหนึ่งด้านและไม่ต่ำกว่า 5%');
    return { mode: 'outpaint', pad };
  }
  if (edit.mode === 'inpaint' && edit.box === undefined && edit.maskId !== undefined) {
    if (typeof edit.maskId !== 'string' || !/^[a-f0-9-]{36}$/.test(edit.maskId)) throw fail('ภาพมาสก์ไม่ถูกต้อง');
    return { mode: 'inpaint', maskId: edit.maskId };
  }
  if (edit.mode === 'inpaint') {
    const b = Array.isArray(edit.box) ? edit.box.map(num) : [];
    if (b.length !== 4 || b.some(v => v === undefined || v < 0 || v > 1)) throw fail('ตำแหน่งที่จะแก้ไม่ถูกต้อง');
    const [x0, y0, x1, y1] = b;
    if (x1 - x0 < 0.05 || y1 - y0 < 0.05 || (x1 - x0) * (y1 - y0) < 0.02) throw fail('พื้นที่ที่จะแก้เล็กเกินไป');
    return { mode: 'inpaint', box: [x0, y0, x1, y1].map(v => Math.round(v * 1000) / 1000) };
  }
  throw fail('โหมดแก้ภาพต้องเป็น outpaint หรือ inpaint');
}

/** Working geometry in pixels: canvas size, where the source sits, and the editable rectangle(s). */
export function planGeometry(info, edit, budget) {
  const { width: w, height: h } = info;
  if (edit.mode === 'outpaint') {
    const { left, top, right, bottom } = edit.pad;
    const w0 = w * (1 + left + right), h0 = h * (1 + top + bottom);
    const s = Math.min(1, Math.sqrt(budget / (w0 * h0)), 1536 / Math.max(w0, h0));
    const W = r16(w0 * s), H = r16(h0 * s);
    const sw = Math.min(W, Math.round(w * s)), sh = Math.min(H, Math.round(h * s));
    // Keep the source flush with a side that was not extended.
    const x = right === 0 && left === 0 ? Math.round((W - sw) / 2) : left === 0 ? 0 : right === 0 ? W - sw : Math.round(left * w * s);
    const y = bottom === 0 && top === 0 ? Math.round((H - sh) / 2) : top === 0 ? 0 : bottom === 0 ? H - sh : Math.round(top * h * s);
    return { width: W, height: H, src: { x, y, w: sw, h: sh }, extended: { left: left > 0, top: top > 0, right: right > 0, bottom: bottom > 0 } };
  }
  const s = Math.min(1, Math.sqrt(budget / (w * h)), 1536 / Math.max(w, h));
  const W = r16(w * s), H = r16(h * s);
  return { width: W, height: H, src: { x: 0, y: 0, w: W, h: H }, box: edit.box };
}

/** Fraction of white pixels in a painted mask (sampled on a 64x64 grid), to reject empty or whole-picture masks. */
export async function maskCoverage(maskBytes) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const img = await loadImage(maskBytes), c = createCanvas(64, 64), x = c.getContext('2d');
  x.drawImage(img, 0, 0, 64, 64);
  const d = x.getImageData(0, 0, 64, 64).data; let on = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 127) on++;
  return on / 4096;
}

/** Renders {image, maskHard, maskSoft} PNG buffers. Mask: white = regenerate. maskSoft is feathered for the final composite. */
export async function renderEditInputs(bytes, info, edit, budget = 720 ** 2, maskBytes) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const g = planGeometry(info, edit, budget);
  const source = await loadImage(bytes);
  const canvas = (fill) => { const c = createCanvas(g.width, g.height), x = c.getContext('2d'); x.fillStyle = fill; x.fillRect(0, 0, g.width, g.height); return [c, x]; };
  const [img, ix] = canvas('#808080');
  const [hard, hx] = canvas(edit.mode === 'outpaint' ? '#ffffff' : '#000000');
  const [soft, sx] = canvas(edit.mode === 'outpaint' ? '#ffffff' : '#000000');
  const feather = Math.max(6, Math.round(Math.min(g.width, g.height) * 0.012));
  if (edit.mode === 'outpaint') {
    const { x, y, w, h } = g.src;
    // Stretch the nearest source rows/columns into the new border so the sampler sees plausible colours instead of flat grey.
    const edge = (sx0, sy0, sw0, sh0, dx, dy, dw, dh) => { if (dw > 0 && dh > 0) ix.drawImage(source, sx0, sy0, sw0, sh0, dx, dy, dw, dh); };
    const sW = source.width, sH = source.height;
    edge(0, 0, 1, sH, 0, y, x, h); edge(sW - 1, 0, 1, sH, x + w, y, g.width - x - w, h);
    edge(0, 0, sW, 1, x, 0, w, y); edge(0, sH - 1, sW, 1, x, y + h, w, g.height - y - h);
    ix.filter = `blur(${feather * 2}px)`; ix.drawImage(img, 0, 0); ix.filter = 'none';
    ix.drawImage(source, x, y, w, h);
    // Hard mask: keep (black) the source, but let the edit reach `ov` px inside on extended sides so seams blend.
    const ov = feather;
    const e = g.extended, kx = x + (e.left ? ov : 0), ky = y + (e.top ? ov : 0);
    const kw = w - (e.left ? ov : 0) - (e.right ? ov : 0), kh = h - (e.top ? ov : 0) - (e.bottom ? ov : 0);
    hx.fillStyle = '#000'; hx.fillRect(kx, ky, kw, kh);
    // Soft mask: the same keep-rectangle, blurred; sides that were not extended run off-canvas so they stay black.
    const bx0 = e.left ? kx : -feather * 4, by0 = e.top ? ky : -feather * 4;
    const bx1 = e.right ? kx + kw : g.width + feather * 4, by1 = e.bottom ? ky + kh : g.height + feather * 4;
    sx.filter = `blur(${feather}px)`; sx.fillStyle = '#000'; sx.fillRect(bx0, by0, bx1 - bx0, by1 - by0); sx.filter = 'none';
  } else if (edit.maskId) {
    if (!maskBytes) throw fail('ไม่พบภาพมาสก์');
    ix.drawImage(source, 0, 0, g.width, g.height);
    const brush = await loadImage(maskBytes);
    // Grow the painted area a little so the repaint covers the object's edge, then feather it for the final composite.
    const grow = Math.max(3, Math.round(Math.min(g.width, g.height) * 0.008));
    const [m, mx] = canvas('#000000');
    const mw = createCanvas(g.width, g.height), wx = mw.getContext('2d'); wx.drawImage(brush, 0, 0, g.width, g.height);
    mx.globalCompositeOperation = 'lighter';
    for (const [dx, dy] of [[0, 0], [grow, 0], [-grow, 0], [0, grow], [0, -grow], [grow, grow], [-grow, -grow], [grow, -grow], [-grow, grow]]) mx.drawImage(mw, dx, dy);
    hx.drawImage(m, 0, 0);
    sx.filter = `blur(${feather}px)`; sx.drawImage(m, 0, 0); sx.filter = 'none';
  } else {
    ix.drawImage(source, 0, 0, g.width, g.height);
    const pad = 0.03, [x0, y0, x1, y1] = g.box;
    const rx = Math.max(0, x0 - pad) * g.width, ry = Math.max(0, y0 - pad) * g.height;
    const rw = Math.min(1, x1 + pad) * g.width - rx, rh = Math.min(1, y1 + pad) * g.height - ry;
    hx.fillStyle = '#fff'; hx.fillRect(rx, ry, rw, rh);
    sx.filter = `blur(${feather}px)`; sx.fillStyle = '#fff'; sx.fillRect(rx, ry, rw, rh); sx.filter = 'none';
  }
  return { geometry: g, image: img.toBuffer('image/png'), maskHard: hard.toBuffer('image/png'), maskSoft: soft.toBuffer('image/png') };
}

/** Fills the edit template: loader names, uploaded file names, prompt, seed, size, steps. */
export function editEditGraph(graph, job, names) {
  graph['5'].inputs.text = job.prompt;
  graph['6'].inputs.width = job.width; graph['6'].inputs.height = job.height;
  graph['7'].inputs.seed = job.seed;
  graph['10'].inputs.filename_prefix = 'Lumicos/' + job.id;
  graph['30'].inputs.name = EDIT_PATCH_FILE;
  graph['20'].inputs.image = names.image;
  graph['21'].inputs.image = names.maskHard;
  graph['23'].inputs.image = names.maskSoft;
  return graph;
}

export async function editPatchInstalled(directory = EDIT_PATCH_DIR) {
  return fs.access(path.join(directory, EDIT_PATCH_FILE)).then(() => true, () => false);
}

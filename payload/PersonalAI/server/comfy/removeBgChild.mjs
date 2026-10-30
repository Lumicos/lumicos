// Background removal worker (ISNet, CPU). Runs in its own process so the server stays responsive.
// Protocol: parent sends {id, input:<png/jpg path>, output:<png path>}, child answers {id, ok, error?}.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, '../knowledge/runtime/package.json'));
const ort = require('onnxruntime-node');
const modelFile = process.env.LUMICOS_REMBG_MODEL;
const SIZE = 1024, MEAN = [0.485, 0.456, 0.406];
let session;

async function cutout(inputPath, outputPath) {
  session ??= await ort.InferenceSession.create(modelFile, { executionProviders: ['cpu'], graphOptimizationLevel: 'all' });
  const img = await loadImage(await fs.readFile(inputPath));
  const W = img.width, H = img.height;
  const small = createCanvas(SIZE, SIZE); const sctx = small.getContext('2d');
  sctx.drawImage(img, 0, 0, SIZE, SIZE);
  const px = sctx.getImageData(0, 0, SIZE, SIZE).data;
  const plane = SIZE * SIZE, data = new Float32Array(3 * plane);
  let max = 1; for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) if (px[i * 4 + c] > max) max = px[i * 4 + c];
  for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) data[c * plane + i] = px[i * 4 + c] / max - MEAN[c];
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, SIZE, SIZE]) });
  const pred = out[session.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity; for (let i = 0; i < plane; i++) { const v = pred[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  const mask = createCanvas(SIZE, SIZE), mctx = mask.getContext('2d'), mimg = mctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < plane; i++) { const a = Math.round(((pred[i] - lo) / span) * 255); mimg.data[i * 4] = mimg.data[i * 4 + 1] = mimg.data[i * 4 + 2] = 255; mimg.data[i * 4 + 3] = a; }
  mctx.putImageData(mimg, 0, 0);
  // scale the mask back to the photo's size (smooth), then take its alpha for the photo
  const big = createCanvas(W, H), bctx = big.getContext('2d');
  bctx.imageSmoothingQuality = 'high'; bctx.drawImage(mask, 0, 0, W, H);
  const alpha = bctx.getImageData(0, 0, W, H).data;
  bctx.clearRect(0, 0, W, H); bctx.drawImage(img, 0, 0, W, H);
  const photo = bctx.getImageData(0, 0, W, H);
  for (let i = 0; i < W * H; i++) photo.data[i * 4 + 3] = alpha[i * 4 + 3];
  bctx.putImageData(photo, 0, 0);
  await fs.writeFile(outputPath, big.toBuffer('image/png'));
}

process.on('message', async ({ id, input, output }) => {
  try { await cutout(input, output); process.send({ id, ok: true }); }
  catch (e) { process.send({ id, ok: false, error: e?.message ?? String(e) }); }
});

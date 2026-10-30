// Flux 3 Klein reference edit (Image Lab templates): the uploaded photo is a reference latent and the
// prompt is an instruction, so the person's face/identity is kept (Z-Image img2img redraws the face).
// Measured on RX 6600 (ROCm 10.0, ComfyUI-Next, 576x768 ref ~0.45 MP): 4 steps ~114 s, 8 steps ~228 s;
// 4 and 8 steps looked the same, so 4 is the default.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const MODELS = fileURLToPath(new URL('../../../ComfyUI-Next/models/', import.meta.url));
export const FLUX_EDIT_FILES = {
  unet: 'flux3_image_klein_sd_Q4_K_M.gguf',
  clip: 'qwen3vl_4b_uncensored-fp8_scaled.safetensors', // user's choice (uncensored); int8_convrot removed
  vae: 'flux2-vae.safetensors',
};
export const FLUX_EDIT_DEFAULTS = { steps: 4, megapixels: 0.45 };
export const FLUX_MERGE_LIMITS = { min: 2, max: 4 };
export const FLUX_REF_LIMITS = { min: 1, max: 4 };
/** Output sizes for reference-guided generation (about 0.4 MP, multiples of 16). */
export const FLUX_REF_SIZES = { portrait: [576, 768], square: [640, 640], landscape: [768, 576] };
/** Each reference image costs sampling time and VRAM, so 3+ references are encoded smaller. */
export const fluxMergeMegapixels = (count) => (count <= 2 ? 0.45 : 0.3);
/** Merge mode is shrunk before ComfyUI (any input size): measured on RX 6600 with two 1536x2048 photos,
 *  refs 0.45 MP + 592x784 output = 383-478 s; refs ~0.2 MP + 480x640 output = 55-67 s with the same look. */
export const FLUX_MERGE_OUT_MP = 0.3;
export const fluxMergeRefMegapixels = (count) => (count <= 2 ? 0.2 : 0.15);
/** Output frame for a merge: aspect of the base (first) image, about 0.3 MP, multiples of 16. */
export function fluxMergeSize(width, height, mp = FLUX_MERGE_OUT_MP) {
  const ar = width > 0 && height > 0 ? width / height : 3 / 4;
  const clamp = n => Math.min(1024, Math.max(256, Math.round(n / 16) * 16));
  return { width: clamp(Math.sqrt(mp * 1048576 * ar)), height: clamp(Math.sqrt(mp * 1048576 / ar)) };
}
/** Flux 3 copies the first reference as the base picture, so "person from image 1 in the place of image 2"
 *  returned image 1 unchanged. When the request names an image as the place/background, that image goes
 *  first and the image numbers in the request are swapped to match the new order. */
const REF_NO = String.raw`(?:ภาพ|รูป)\s*(?:ที่\s*)?(\d)|images?\s*#?\s*(\d)|photo\s*#?\s*(\d)`;
const SCENE_RE = new RegExp(String.raw`(?:สถานที่|ฉาก|พื้นหลัง|บรรยากาศ|background|scene|location|place|setting)\s*(?:ของ|ใน|จาก|ตาม|of|from|in)?\s*(?:${REF_NO})`, 'i');
export function fluxMergeOrder(prompt, count) {
  const text = String(prompt ?? '');
  const order = Array.from({ length: count }, (_, i) => i);
  const m = SCENE_RE.exec(text);
  const n = m ? Number(m[1] ?? m[2] ?? m[3]) : 0;
  if (!(n >= 2 && n <= count)) return { order, prompt: text };
  order.splice(n - 1, 1); order.unshift(n - 1);
  const swapped = text.replace(new RegExp(REF_NO, 'gi'), (all, a, b, c) => {
    const k = Number(a ?? b ?? c);
    const to = k === n ? 1 : k === 1 ? n : k;
    return all.replace(/\d/, String(to));
  });
  return { order, prompt: swapped };
}
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export async function fluxEditInstalled({ access = fs.access, dir = MODELS } = {}) {
  const files = [['diffusion_models', FLUX_EDIT_FILES.unet], ['text_encoders', FLUX_EDIT_FILES.clip], ['vae', FLUX_EDIT_FILES.vae]];
  const missing = [];
  for (const [sub, name] of files) await access(dir + sub + '/' + name).catch(() => missing.push(name));
  return { ready: !missing.length, missing };
}

/** Wraps a style description into an edit instruction that asks Flux to keep the person. */
export function fluxEditInstruction(prompt) {
  const text = String(prompt ?? '').trim().replace(/,?\s*same subject, same pose and composition as the original photo/i, '');
  if (!text) throw fail('ใส่คำสั่งแก้ภาพ');
  return `Edit this photo: ${text}. Keep the same person with the exact same face, identity, hairstyle, pose and composition.`;
}

/** Wraps a merge request (2-4 reference photos) into an instruction that keeps every person and product. */
export function fluxMergeInstruction(prompt, count = 2) {
  const text = String(prompt ?? '').trim();
  if (!text) throw fail('ใส่คำสั่งรวมภาพ');
  // Group photos: faces get tiny in a full-length frame and drift/merge, so ask for a closer medium shot (measured: 4 people, 640x480, 125 s, faces stay close to the references).
  const group = count >= 3 ? ` Frame it as a medium shot from the waist up so every face is large, sharp and clearly visible, with all ${count} references shown as separate people or objects.` : '';
  return `Combine the reference images into one new photo (image 1, image 2 and so on are the references in the order given): ${text}.${group} Keep each person's face and identity and each object's design exactly the same as in its reference image.`;
}

/** Wraps a reference-guided request: a NEW photo that borrows people/objects/style from 1-4 reference photos. */
export function fluxRefInstruction(prompt) {
  const text = String(prompt ?? '').trim();
  if (!text) throw fail('ใส่คำสั่งสร้างภาพจากภาพอ้างอิง');
  return `Create a new photo using the reference images (image 1, image 2 and so on are the references in the order given): ${text}. Keep each person's face and identity and each object's design the same as in its reference image.`;
}

export function fluxEditGraph({ inputName, inputNames, size, prompt, seed, steps = FLUX_EDIT_DEFAULTS.steps, megapixels, keepRefSize = false, prefix = 'lumicos_flux_edit' }) {
  const names = inputNames ?? [inputName];
  if (!Array.isArray(names) || !names.length || names.length > FLUX_MERGE_LIMITS.max || names.some(n => typeof n !== 'string' || !n)) throw fail('Flux edit needs uploaded images');
  megapixels ??= names.length > 1 ? fluxMergeMegapixels(names.length) : FLUX_EDIT_DEFAULTS.megapixels;
  const nodeId = i => (i === 0 ? '11' : 'img' + i);
  const refs = Object.fromEntries(names.map((n, i) => ['images.image' + i, [nodeId(i), 0]]));
  const sized = size && Number.isInteger(size.width) && Number.isInteger(size.height) && size.width % 16 === 0 && size.height % 16 === 0;
  if (size && !sized) throw fail('Invalid Flux reference size');
  const loads = Object.fromEntries(names.map((n, i) => [nodeId(i), { class_type: 'LoadImage', inputs: { image: n } }]));
  if (!Number.isInteger(steps) || steps < 1 || steps > 16) throw fail('Invalid Flux edit steps');
  return {
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: FLUX_EDIT_FILES.clip, type: 'flux3', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: FLUX_EDIT_FILES.vae } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    '32': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
    ...loads,
    ...(sized ? { '5': { class_type: 'EmptyFlux2LatentImage', inputs: { width: size.width, height: size.height, batch_size: 1 } } } : {}),
    '17': { class_type: 'ReferenceMultiLatent', inputs: { positive: ['4', 0], negative: ['32', 0], vae: ['3', 0], ...(keepRefSize ? { resolution: 'keep resolution' } : { resolution: 'resize', 'resolution.megapixels': megapixels }), ...refs } },
    '45': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: FLUX_EDIT_FILES.unet } },
    '7': { class_type: 'KSampler', inputs: { seed, steps, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model: ['45', 0], positive: ['17', 0], negative: ['17', 1], latent_image: sized ? ['5', 0] : ['17', 2] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: prefix, images: ['8', 0] } },
  };
}

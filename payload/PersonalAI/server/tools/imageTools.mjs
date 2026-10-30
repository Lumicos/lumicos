/** ComfyUI image-generation tool exposed to the model tool registry. */

// Lumicos picks the shape from what she is drawing; explicit width/height (set when the user names a ratio) always win.
export const ASPECTS = {
  portrait: { width: 768, height: 1024 },
  tall: { width: 576, height: 1024 },
  square: { width: 768, height: 768 },
  wide: { width: 1024, height: 768 },
  landscape: { width: 1024, height: 576 },
};

const SUBJECTS = ['lumicos', 'roleplay', 'other'];
const QUALITIES = ['fast', 'normal', 'high'];
const pick = (value, allowed) => { const v = typeof value === 'string' ? value.trim().toLowerCase() : value; return allowed.includes(v) ? v : undefined; };

/** Small models sometimes fill optional fields with something off-list ("subject": "cat", "aspect": "vertical",
 *  "width": "1024"). Fix or drop those instead of failing the whole picture; the prompt still decides what is drawn. */
export function normalizeImageArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  const out = { ...args };
  if (Array.isArray(out.prompt)) out.prompt = out.prompt.filter((x) => typeof x === 'string').join(', ');
  for (const [key, allowed] of [['subject', SUBJECTS], ['aspect', Object.keys(ASPECTS)], ['quality', QUALITIES]]) {
    if (!(key in out)) continue;
    const v = pick(out[key], allowed);
    if (v === undefined) delete out[key]; else out[key] = v;
  }
  for (const key of ['width', 'height']) {
    if (!(key in out)) continue;
    const n = typeof out[key] === 'string' && out[key].trim() !== '' ? Number(out[key]) : out[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) delete out[key];
    else out[key] = Math.min(1536, Math.max(256, Math.round(n)));
  }
  return out;
}

export function imageTools(comfy) {
  return [{
    name: 'generate_image',
    permission: 'write',
    description: 'Generate an image with the local Z-Image Turbo INT8. Use an English visual prompt. Call web_search first when the request depends on a person, MV, song, latest/current information, or other real-world reference.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        subject: { type: 'string', enum: ['lumicos', 'roleplay', 'other'], description: 'For a selfie/photo of yourself: "lumicos" when you are yourself, "roleplay" when you are playing a role (the prompt then describes that role, not Lumicos). Omit for any other picture.' },
        aspect: { type: 'string', enum: ['portrait', 'tall', 'square', 'wide', 'landscape'], description: 'Shape of the picture, chosen from its content: portrait (default) for people, selfies and full-body shots; landscape for scenery, rooms, cityscapes and wide scenes; square for logos, icons and objects; tall for phone wallpapers; wide for general 4:3. The user\'s own words or ratio override this.' },
        width: { type: 'integer', minimum: 256, maximum: 1536 },
        height: { type: 'integer', minimum: 256, maximum: 1536 },
        seed: { type: ['integer','string','null'], description: 'Optional seed. Integer or numeric string preserves it; null, empty, random, or invalid values generate a random integer.' },
        quality: { type:'string',enum:['fast','normal','high'],description:'Z-Image Turbo INT8: Fast ~576px, Quality 720px (default), High Quality 1024px square pixel budgets. All use 8 steps, CFG 1 and one 4x upscale.' },
      },
      required: ['prompt'],
    },
    normalizeArgs: normalizeImageArgs,
    preview: ({ prompt }) => ({ action: 'สร้างภาพ', target: String(prompt).slice(0, 160) }),
    handler: async ({ prompt, aspect, width, height, seed, quality }) => {
      const shape = (width || height) ? {} : (ASPECTS[aspect] ?? ASPECTS.portrait);
      const job = await comfy.create({ prompt, width: width ?? shape.width, height: height ?? shape.height, seed, quality });
      // Return the ID immediately so the client can track and cancel queued work.
      return { summary: 'เข้าคิวสร้างภาพแล้ว', data: { jobId: job.id },
        content: JSON.stringify({ status: job.status, jobId: job.id }) };
    },
  }];
}

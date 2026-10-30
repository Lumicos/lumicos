import type { LLMProvider } from '../providers/types';

export interface EditPlan {
  edit: { mode: 'outpaint'; pad: { left: number; top: number; right: number; bottom: number } } | { mode: 'inpaint'; box: [number, number, number, number] };
  prompt: string;
}

const OUTPAINT = /ขยาย(?:ภาพ|รูป|ขอบ|พื้นที่|ฉาก)|เพิ่ม(?:พื้นที่|ขอบ)(?:ภาพ|รูป)?|ต่อ(?:ขอบ|ภาพ|รูป)|ภาพ(?:กว้าง|สูง)ขึ้น|outpaint|extend(?:ing)? (?:the )?(?:image|picture|canvas|photo)|widen|expand (?:the )?(?:image|picture|canvas)/i;
const INPAINT = /(?:เติม|ใส่|วาง|เพิ่ม|ตกแต่ง|จัด|แทนที่|เปลี่ยน|ลบ|เอา.{0,12}ออก|แต่ง)(?:.{0,40})(?:เฟอร์นิเจอร์|ของ|โซฟา|เตียง|โต๊ะ|เก้าอี้|ต้นไม้|ห้อง|ผนัง|พื้น|วัตถุ|คน|รถ|สัตว์|หมา|แมว|furniture|sofa|bed|table|chair|plant|object|person|car)|furnish|inpaint|add .{0,30}(?:to|in) (?:the )?(?:room|image|picture)|remove .{0,30}from|replace .{0,30}with/i;

/** An explicit request to change the attached picture (extend its borders, or add/remove/replace something in it). */
export function editMode(text: string): 'outpaint' | 'inpaint' | undefined {
  if (OUTPAINT.test(text)) return 'outpaint';
  if (INPAINT.test(text)) return 'inpaint';
  return undefined;
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));
/** Sides the user names ("ซ้ายขวา", "ทุกด้าน", "left and right") with an optional percentage. */
export function padFromText(text: string): { left: number; top: number; right: number; bottom: number } | undefined {
  const pct = text.match(/(\d{1,3})\s*(?:%|เปอร์เซ็นต์|เปอร์เซนต์|percent)/i);
  const amount = clamp((pct ? Number(pct[1]) : 30) / 100);
  const pad = { left: 0, top: 0, right: 0, bottom: 0 };
  if (/ทุกด้าน|ทั้งสี่ด้าน|ทุกทิศ|รอบ(?:ด้าน|ภาพ|รูป)|all (?:four )?sides|every side/i.test(text)) return { left: amount, top: amount, right: amount, bottom: amount };
  if (/ซ้าย|\bleft\b/i.test(text)) pad.left = amount;
  if (/ขวา|\bright\b/i.test(text)) pad.right = amount;
  if (/(?:ด้าน)?บน|ขึ้นบน|ท้องฟ้า|เพดาน|\b(?:top|up|upward|above)\b/i.test(text)) pad.top = amount;
  if (/(?:ด้าน)?ล่าง|ลงล่าง|พื้น|\b(?:bottom|down|downward|below)\b/i.test(text)) pad.bottom = amount;
  return Object.values(pad).some(v => v > 0) ? pad : undefined;
}

const SYSTEM = `You plan ONE edit of the attached picture from the user's request (Thai or English). Reply with a single JSON object and nothing else:
{"mode":"outpaint"|"inpaint","pad":{"left":0,"top":0,"right":0,"bottom":0},"box":[x0,y0,x1,y1],"prompt":"..."}
- mode "outpaint": the user wants the picture extended/widened. pad = fraction of the CURRENT width/height to add on each side (0.25 = 25%); sides not mentioned stay 0. Omit box.
- mode "inpaint": the user wants something added, removed or replaced INSIDE the picture (e.g. furnish an empty room). box = the region to repaint as fractions of the picture, x to the right, y downward, from the top-left corner (0..1). Cover the whole area where the new things will appear (for furniture: the floor/wall area where it will stand), nothing more. Omit pad.
- prompt: ONE English paragraph describing the COMPLETE picture as it will look after the edit (unchanged parts included), same photographic style, lighting and camera as the original. No instructions, no preamble. Never use negations (no/without/not): describe what IS there ("empty street with only a red motorcycle"), because the image model ignores negatives.`;

function extractJson(text: string): any | undefined {
  const m = text.replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/);
  if (!m) return undefined;
  try { return JSON.parse(m[0]); } catch { return undefined; }
}
const isBox = (b: any): b is [number, number, number, number] => Array.isArray(b) && b.length === 4 && b.every(v => typeof v === 'number' && Number.isFinite(v));

/**
 * Looks at the picture once (vision) and returns the edit plus an English prompt of the finished scene.
 * Deterministic text rules decide the mode and the outpaint sides when they can; Gemma finds the area to repaint.
 */
export async function planImageEdit(provider: LLMProvider, input: { imageDataUrl: string; instruction: string; signal: AbortSignal; correlationId?: string; forceMode?: 'outpaint' | 'inpaint' }): Promise<EditPlan> {
  const { imageDataUrl, instruction, signal, correlationId, forceMode } = input;
  signal.throwIfAborted();
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(90000)]);
  let text = '', failure: Error | undefined;
  await provider.streamChat({
    purpose: 'image-edit-plan', correlationId, enableThinking: false,
    params: { temperature: 0.1, topP: 0.9, maxTokens: 700 },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: [{ type: 'text', text: instruction }, { type: 'image_url', image_url: { url: imageDataUrl } }] },
    ],
  } as any, { onToken: t => { text += t; }, onError: e => { failure = e; }, onDone: () => {} }, bounded);
  bounded.throwIfAborted();
  if (failure) throw new Error('วางแผนแก้ภาพไม่สำเร็จ: ' + failure.message);
  const plan = extractJson(text);
  if (!plan || typeof plan !== 'object') throw new Error('Lumicos อ่านภาพแล้วแต่สรุปแผนแก้ภาพไม่ได้ ลองบอกให้ชัดขึ้น เช่น "ขยายภาพไปทางซ้าย 30%" หรือ "ใส่โซฟาตรงพื้นห้อง"');
  const prompt = typeof plan.prompt === 'string' && plan.prompt.trim().length > 10 ? plan.prompt.trim().slice(0, 1500) : instruction;
  const wanted = forceMode ?? editMode(instruction);
  const mode = wanted ?? (plan.mode === 'outpaint' || plan.mode === 'inpaint' ? plan.mode : undefined);
  if (mode === 'outpaint') {
    const pad = padFromText(instruction) ?? (plan.pad && typeof plan.pad === 'object' ? { left: clamp(+plan.pad.left || 0), top: clamp(+plan.pad.top || 0), right: clamp(+plan.pad.right || 0), bottom: clamp(+plan.pad.bottom || 0) } : undefined);
    if (!pad || !Object.values(pad).some(v => v >= 0.05)) throw new Error('ไม่แน่ใจว่าจะให้ขยายด้านไหน ลองบอกเช่น "ขยายซ้ายขวา" หรือ "ขยายทุกด้าน 25%"');
    return { edit: { mode: 'outpaint', pad }, prompt };
  }
  if (mode === 'inpaint') {
    if (!isBox(plan.box)) throw new Error('Lumicos หาพื้นที่ที่จะแก้ในภาพไม่เจอ ลองบอกตำแหน่งให้ชัดขึ้น เช่น "ใส่โซฟาตรงกลางห้อง"');
    const [a, b, c, d] = plan.box.map(clamp);
    const box: [number, number, number, number] = [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
    if ((box[2] - box[0]) * (box[3] - box[1]) < 0.02) throw new Error('พื้นที่ที่หาได้เล็กเกินไป ลองบอกตำแหน่งให้ชัดขึ้น');
    return { edit: { mode: 'inpaint', box }, prompt };
  }
  throw new Error('ไม่เข้าใจว่าจะแก้ภาพแบบไหน ลองบอกว่า "ขยายภาพไปทางซ้าย" หรือ "ใส่เฟอร์นิเจอร์ในห้อง"');
}

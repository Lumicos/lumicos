export const IMAGE_SIZES = {
  portrait: { width: 768, height: 1024, label: 'แนวตั้ง 3:4' },
  landscape: { width: 1024, height: 576, label: 'แนวนอน 16:9' },
  square: { width: 768, height: 768, label: 'จัตุรัส 1:1' },
  tall: { width: 576, height: 1024, label: 'แนวตั้ง 9:16' },
  wide: { width: 1024, height: 768, label: 'แนวนอน 4:3' },
};
export type ImageSize = keyof typeof IMAGE_SIZES;
export function preserveImageAspect(prompt:string,size:ImageSize):string {
 const ratio=IMAGE_SIZES[size].label.match(/\d+:\d+/)![0];
 return prompt.replace(/\b\d+\s*:\s*\d+\b/g,'').trim()+`\nAspect ratio: ${ratio}.`;
}
// A known subject in an invented scene needs no current-reference lookup.
export const needsImageResearch = (prompt:string) => /\b(?:mv|music video|latest|current|today|recent)\b|ล่าสุด|เอ็มวี|มิวสิกวิดีโอ|ค้น(?:เว็บ|หา)|เสิร์ช|อ้างอิง|ตามข่าว/i.test(prompt);
export interface ImageOptions {
  size?: ImageSize | 'original';
  inputFile?: File;
  denoise?: number;
  backend?: import('../services/localService').ImageBackend;
  quality?: import('../services/localService').ImageQuality;
}

export function requestedSize(text: string): ImageSize | undefined {
  if (/16\s*:\s*9/.test(text)) return 'landscape';
  if (/9\s*:\s*16/.test(text)) return 'tall';
  if (/4\s*:\s*3/.test(text)) return 'wide';
  if (/3\s*:\s*4/.test(text)) return 'portrait';
  if (/1\s*:\s*1|จัตุรัส|\bsquare\b/i.test(text)) return 'square';
  if (/แนวนอน|\blandscape\b/i.test(text)) return 'landscape';
  if (/แนวตั้ง|\bportrait\b/i.test(text)) return 'portrait';
}

// Explicit requests only: a discussion about images remains ordinary chat.
export function imagePrompt(text: string): string | undefined {
  const normalized=text.trim().replace(/^(?:(?:เธอ|คุณ|Lumicos|โนวา|โนวา)[,\s]*)?(?:(?:ช่วย|ลอง|รบกวน)\s*){0,2}/i,'');
  const thaiOrSlash = normalized.match(/^(?:สร้าง(?:ภาพ|รูป)|เจน(?:ภาพ|รูป)|วาด(?:ภาพ|รูป)|ถ่าย(?:ภาพ|รูป)|ขอ(?:ภาพ|รูป)|\/image\s+)[:：\s]*([\s\S]+)$/i);
  const english = normalized.match(/^(?:please\s+)?(generate|create|draw)\b[:：\s]*([\s\S]+)$/i);
  let prompt=thaiOrSlash?.[1]?.trim();
  if (!prompt && english) {
    const [,verb,remainder]=english;
    // "draw" is intrinsically visual. Generate/create remain image commands only
    // when their object explicitly names an image, picture, photo, or portrait.
    if (verb.toLowerCase()==='draw' || /\b(?:image|picture|photo|portrait)\b/i.test(remainder)) prompt=remainder.trim();
  }
  if (!prompt || /^(?:ได้ไหม|ได้หรือ|อย่างไร|ยังไง|คืออะไร|ต้องทำ)/.test(prompt)) return;
  return prompt;
}

/** A short confirmation can continue an image request proposed by Lumicos. */
export function imageFollowup(text: string, previousAssistantText = ''): boolean {
  return /^(?:ได้เลย|โอเค|ตกลง|เอาเลย|ทำเลย|เจน(?:ได้)?เลย|จัดไป|ใช่|yes|okay|ok|go ahead|do it)(?:\s*ๆ)?[\s!！。.]*$/i.test(text.trim())
    && /(สร้าง|เจน|วาด|generate|create|draw).{0,24}(ภาพ|รูป|image|picture|photo)/i.test(previousAssistantText);
}

export function imagePromptFromModelText(text: string): string | undefined {
  const block = text.match(/(?:image\s*(?:description|prompt)[^\n]*|^\s*\**prompt\**\s*[:：])\s*\**\]?\**\s*\n*\s*\*?([\s\S]{20,}?)(?:\*?\s*\n\s*\n|$)/im);
  if (block?.[1]?.trim()) return block[1].replace(/\*+/g, '').trim();
  const match = text.match(/(?:new\s+)?prompt\s+concept\s*:\s*\*?([\s\S]*?)(?:\*?\n\n|$)/i);
  if (match?.[1]?.trim()) return match[1].replace(/\*+/g, '').trim();
  if (/(?:เราจะ|กำลังจะ|เดี๋ยว).*?(?:สร้าง|เจน|วาด)ภาพ/i.test(text)) return text.replace(/\s+/g, ' ').trim();
  if (/(ลองปรับ|ลองเปลี่ยน|สไตล์นี้|prompt refinement|เสื้อ|ชุด|ลุค).{0,80}(คาเฟ่|เซ็กซี่|casual|outfit|style|top|skirt)/is.test(text)) return text.replace(/\s+/g, ' ').trim();
}

// An edit must be an instruction, not a mention: "ชอบสีท้องฟ้าตรงไหน" or "แสงสีทองอบอุ่น" after a picture is chat.
const EDIT_LEAD = /^(?:(?:เธอ|คุณ|Lumicos|โนวา|งั้น|แล้ว|ถ้างั้น|ok|โอเค)[,\s]*)?(?:(?:ช่วย|ลอง|รบกวน|อยากให้|ขอให้)\s*){0,2}(?:ปรับ|แก้|เปลี่ยน|เพิ่ม|ลด|ใส่|ถอด|เอา(?:แบบ|เป็น|ออก|ชุด|สี)|ทำ(?:ให้|เป็น)|ขอ(?:แบบ|เป็น|ชุด|สี|ท่า|ลุค|ฉาก|พื้นหลัง|มุม|โทน))/i;
const EDIT_OBJECT = /(?:ปรับ|แก้|เปลี่ยน|เพิ่ม|ลด|ใส่|ถอด)\S{0,12}(?:ภาพ|รูป|ฉาก|พื้นหลัง|สี|ชุด|ท่า|ลุค|แสง|ผม|หน้า|มุม|โทน)/i;
const EDIT_EN = /\b(?:make (?:it|her|him|the)|change (?:the|her|his|it)|add (?:a|an|some|more)|remove (?:the|her|his)|more (?:sexy|seductive|casual|dramatic)|different (?:outfit|pose|style|background))\b/i;
const ACCEPT_PROPOSAL = /ลองทำตาม|ตามที่เธอ(?:ว่า|บอก|เสนอ)|เอาตามนั้น|แบบนั้นเลย/i;
export function imageContinuation(text: string, history: any[] = []): boolean {
  const t = text.trim();
  if (!(EDIT_LEAD.test(t) || EDIT_OBJECT.test(t) || EDIT_EN.test(t) || ACCEPT_PROPOSAL.test(t))) return false;
  return history.slice(-10).some((m) =>
    m.parts?.some((p: any) => p.type === 'image') ||
    m.toolRuns?.some((r: any) => r.tool === 'generate_image') ||
    (m.role === 'user' && imagePrompt(textOfParts(m.parts ?? [])))
  );
}

function textOfParts(parts: any[]): string { return parts.filter((p) => p.type === 'text').map((p) => p.text).join(''); }

export type ImageIntent = { kind: 'none'|'create'|'refine'|'followup'; prompt?: string };
/** "send me a selfie", "I want to see your face": the character photographs itself (or its roleplay role). */
export const SELFIE_REQUEST = /(?:ถ่าย(?:รูป|ภาพ)(?:เธอ|คุณ|ตัวเธอ)|(?:รูป|ภาพ)(?:เธอ|คุณ)(?:หน่อย|ตอนนี้|ให้ดู)|เซลฟี่|เซลฟี|เซลฟี่|selfie|ถ่ายรูป(?:ตัวเอง|ให้ดู|มา(?:ให้)?ดู|ส่งมา|หน่อย)|ส่งรูป(?:ตัวเอง|มา(?:ให้)?ดู|หน่อย|มา)|ขอ(?:ดู)?รูป(?:เธอ|คุณ|ตัวเอง|หน่อย)|อยากเห็นหน้า|ขอดูหน้า|show me (?:your face|yourself|a selfie)|send (?:me )?(?:a )?(?:pic|photo|selfie))/i;

/** "เจนเลย", "โยนเข้าเจนภาพสิ", "generate it": turn the prompt Lumicos just wrote into an image. */
export const GENERATE_NOW = /(?:เจน|สร้าง|วาด|ทำ)(?:เป็น)?(?:ภาพ|รูป)|เข้าเจน|เจน(?:เลย|ให้|ดู|สิ|ที)|ส่ง(?:ภาพ|รูป)มา|generate (?:it|the image|that)|make (?:the|an|that) (?:image|picture)/i;

export const MORE_SHOTS = /ถ่าย(?:ต่อ|อีก|ใหม่|เลย|เพิ่ม|ให้ดู)|อีก(?:สัก)?\s*(?:รูป|ภาพ|ช็อต|ช็อท|ใบ)|ขออีก(?:รูป|ภาพ)?|(?:another|one more) (?:pic|photo|shot|selfie)|take (?:another|more)/i;

export function resolveImageIntent(history: any[]): ImageIntent {
  const user = [...history].reverse().find((m) => m.role === 'user');
  if (!user) return {kind:'none'};
  const text = textOfParts(user.parts ?? []);
  if (SELFIE_REQUEST.test(text)) return {kind:'create',prompt:text};
  const previous = [...history].reverse().find((m) => m.role === 'assistant');
  const written = previous ? imagePromptFromModelText(textOfParts(previous.parts ?? [])) : undefined;
  if (written && GENERATE_NOW.test(text)) return {kind:'create',prompt:written};
  // "ถ่ายต่อ", "ถ่ายอีกรูป", "อีกช็อต": keep the photo session going after a picture (or a written prompt).
  if (MORE_SHOTS.test(text) && history.slice(-8).some((m) => m.parts?.some((p: any) => p.type === 'image') || m.toolRuns?.some((r: any) => r.tool === 'generate_image')
    || (m.role === 'assistant' && imagePromptFromModelText(textOfParts(m.parts ?? []))) || (m.role === 'user' && (SELFIE_REQUEST.test(textOfParts(m.parts ?? [])) || imagePrompt(textOfParts(m.parts ?? []))))))
    return {kind:'create',prompt:text};
  const direct = imagePrompt(text);
  if (direct) return {kind:'create',prompt:direct};
  if (imageFollowup(text, previous ? textOfParts(previous.parts ?? []) : '')) return {kind:'followup'};
  if (imageContinuation(text, history)) return {kind:'refine'};
  if (GENERATE_NOW.test(text)) return {kind:'create',prompt:text};
  return {kind:'none'};
}

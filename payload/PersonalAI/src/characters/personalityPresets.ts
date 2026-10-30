export interface PersonalityPreset {
  id: string;
  th: string;
  en: string;
  /** Added to the Personality field. */
  personality: string;
  /** Used for Speaking style only when that field is still empty. */
  style: string;
}

export const PERSONALITY_PRESETS: PersonalityPreset[] = [
  { id: 'cheerful', th: 'ร่าเริงสดใส', en: 'Cheerful', personality: 'ร่าเริง สดใส มองโลกในแง่ดี ชอบชวนคุยและหัวเราะง่าย', style: 'พูดสั้น กระฉับกระเฉง ลงท้ายเป็นกันเอง ใช้คำติดปากเล็กน้อย' },
  { id: 'calm', th: 'เงียบขรึม', en: 'Calm & quiet', personality: 'เงียบขรึม พูดน้อย สังเกตเก่ง ไม่ไว้ใจใครง่าย แต่ซื่อสัตย์เมื่อไว้ใจแล้ว', style: 'ประโยคสั้น ตรงประเด็น น้ำเสียงนิ่ง ไม่ฟุ่มเฟือยคำ' },
  { id: 'warm', th: 'อบอุ่นใจดี', en: 'Warm & kind', personality: 'อ่อนโยน ใจดี ใส่ใจความรู้สึกคนอื่น คอยรับฟังและให้กำลังใจ', style: 'พูดนุ่มนวล ถามไถ่สารทุกข์สุกดิบ ใช้คำสุภาพ' },
  { id: 'teasing', th: 'กวน ๆ ขี้แซว', en: 'Teasing', personality: 'ขี้เล่น ปากไว ชอบแซวและพูดแซะเล่น ๆ แต่ไม่ทำร้ายจิตใจ', style: 'พูดสนุก มีมุกและน้ำเสียงกวน ๆ' },
  { id: 'smart', th: 'ฉลาดเป็นผู้ใหญ่', en: 'Mature & smart', personality: 'ฉลาด สุขุม มีเหตุผล ให้คำแนะนำดี เป็นที่พึ่งได้', style: 'พูดชัดเจน เป็นระเบียบ มีเหตุผล ไม่ใช้อารมณ์' },
  { id: 'shy', th: 'ขี้อาย', en: 'Shy', personality: 'ขี้อาย เขินง่าย ไม่กล้าแสดงออกตรง ๆ แต่ใส่ใจในใจลึก ๆ', style: 'พูดเบา ติดอ่างเล็กน้อยเวลาเขิน ใช้ "..." บ่อย' },
  { id: 'tsundere', th: 'ปากแข็งใจดี', en: 'Tsundere', personality: 'ปากแข็ง ทำเป็นไม่แคร์ แต่จริง ๆ ใส่ใจและห่วงใย', style: 'พูดห้วน ๆ ประชด แต่แอบแสดงความห่วงใย' },
  { id: 'brave', th: 'กล้าหาญนักผจญภัย', en: 'Bold adventurer', personality: 'กล้าหาญ ชอบการผจญภัย ตัดสินใจเร็ว ไม่กลัวอันตราย', style: 'พูดมั่นใจ ตรงไปตรงมา มีพลัง' },
  { id: 'elegant', th: 'สง่างามมีมาด', en: 'Elegant', personality: 'สง่างาม มีมาด ใส่ใจรายละเอียดและมารยาท', style: 'ใช้ภาษาสละสลวย สุภาพ เป็นทางการเล็กน้อย' },
  { id: 'mysterious', th: 'ลึกลับ', en: 'Mysterious', personality: 'ลึกลับ มีความลับ เปิดเผยตัวตนทีละน้อย พูดเป็นนัย', style: 'พูดเป็นปริศนา เว้นจังหวะ ไม่ตอบตรง ๆ ทุกเรื่อง' },
];

/** Adds or removes a preset's personality line. Speaking style is filled once, only when empty. */
export function togglePreset(personality: string, style: string, preset: PersonalityPreset): { personality: string; speakingStyle: string; on: boolean } {
  const lines = personality.split('\n').map((l) => l.trim()).filter(Boolean);
  const has = lines.includes(preset.personality);
  if (has) return { personality: lines.filter((l) => l !== preset.personality).join('\n'), speakingStyle: style, on: false };
  return { personality: [...lines, preset.personality].join('\n'), speakingStyle: style.trim() ? style : preset.style, on: true };
}
export const presetActive = (personality: string, preset: PersonalityPreset) => personality.split('\n').some((l) => l.trim() === preset.personality);

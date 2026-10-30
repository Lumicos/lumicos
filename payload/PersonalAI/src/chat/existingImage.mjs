// Resolve requests for an image already present in this conversation.
// This deliberately never creates a URL or calls the image backend.
export function existingImageReply(history) {
  const textOf = (m) => m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
  const user = [...history].reverse().find((m) => m.role === 'user');
  const request = user ? textOf(user) : '';
  if (!/(โชว์|แสดง|เอา|ขอดู|ดู|show|display).*(รูป|ภาพ|image|picture|photo)|(รูป|ภาพ).*(มาโชว์|มาแสดง)/i.test(request)) return;
  if (/(สร้าง|เจน|วาด|generate|create|draw|แก้ไข|แต่งภาพ)/i.test(request)) return;
  const images = [];
  const seen = new Set();
  for (const message of history) for (const part of message.parts) {
    if (part.type === 'image' && !seen.has(part.url)) { seen.add(part.url); images.push(part); }
  }
  if (!images.length) return { text: 'ยังไม่มีภาพเดิมในแชทนี้ค่ะ', images: [] };
  const numbered = request.match(/(?:รูป|ภาพ)(?:ที่)?\s*(\d+)|(?:image|picture|photo)\s*(\d+)/i);
  const index = numbered ? Number(numbered[1] ?? numbered[2]) - 1 : undefined;
  if (index !== undefined && images[index]) return { text: `รูปที่ ${index + 1} นี้ค่ะ`, images: [images[index]] };
  // “ภาพที่ชอบ/ภาพนั้น” refers to the single image in the preceding assistant turn,
  // rather than asking the user to see every generated image in the conversation.
  if (/(ชอบ|นั้น|favorite|that|chosen)/i.test(request)) {
    // Prefer the assistant turn that explicitly recorded a preference. This
    // lets “เอาภาพที่เธอชอบมาโชว์” resolve an older image instead of guessing
    // from the newest generated image.
    const previousAssistant = [...history].reverse().find((m) =>
      m.role === 'assistant' && m.parts.some((p) => p.type === 'image') &&
      /(ชอบ|ถูกใจ|favorite|liked|prefer)/i.test(textOf(m))
    ) ?? [...history].reverse().find((m) => m.role === 'assistant' && m.parts.some((p) => p.type === 'image'));
    const referenced = previousAssistant?.parts.filter((p) => p.type === 'image').at(-1);
    if (referenced) return { text: 'ภาพนี้ค่ะ', images: [referenced] };
  }
  if (/(ล่าสุด|เมื่อกี้|last|latest)/i.test(request)) return { text: 'ภาพล่าสุดนี้ค่ะ', images: [images.at(-1)] };
  if (images.length === 1) return { text: 'รูปนี้ค่ะ', images };
  return { text: 'ภาพเดิมในแชทอยู่ด้านล่างตามลำดับค่ะ', images };
}

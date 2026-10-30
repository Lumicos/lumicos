// A researched trip plan as a Word file (claude-20261025, user: "การวางแผนทริปเที่ยว"): "วางแผนเที่ยวเชียงใหม่ 3 วัน 2 คืน
// งบ 10000 บาท". Bounded like research: the program searches the web with fixed queries, the model only arranges places,
// food and prices from the numbered sources into days, and each line is checked against the source it cites (its numbers
// must be in that source, and so must part of the place name). One revision, then lines that still fail are dropped.
// The model never adds up prices; the budget section lists prices as the sources give them.
import { collectSources, numbersIn, numberIn, thaiToday } from './research.mjs';

export const MAX_DAYS = 10;
export const MAX_TRIP_SOURCES = 8;
const DAYS_PER_CALL = 4;
const arabic = (s) => String(s ?? '').replace(/[๐-๙]/gu, (c) => String(c.charCodeAt(0) - 0x0e50));

// ---- the request --------------------------------------------------------------------------------------------
const PLAN_A = String.raw`(?:วางแผน|แพลน|แพล้น)\s*(?:การ\s*)?(?:ไป\s*)?(?:ท่อง)?(?:เที่ยว|ทริป|ทัวร์)`;
const PLAN_B = String.raw`จัด\s*(?:ทริป|ทัวร์|(?:แผน|โปรแกรม)\s*(?:การ\s*)?(?:ไป\s*)?(?:ท่อง)?เที่ยว)`;
const PLAN_C = String.raw`(?:ทำ|ขอ|อยากได้|เขียน|ออกแบบ)\s*(?:(?:แผน|โปรแกรม|แพลน)\s*(?:การ\s*)?(?:ไป\s*)?(?:ท่อง)?เที่ยว|ทริป|itinerary)`;
const ASK_TH = new RegExp(`(?:${PLAN_A}|${PLAN_B}|${PLAN_C})\\s*(.*)$`, 'iu');
const ASK_THEN = /(?:อยาก|จะ|กำลังจะ)\s*ไป\s*(?:ท่อง)?เที่ยว\s*(.{2,40}?)\s+.{0,30}?(?:ช่วย\s*)?(?:วางแผน|แพลน|จัดทริป|จัดแผน|ทำแผน)/iu;
const ASK_EN = /\bplan\s+(?:a|an|my|our|the)?\s*(?:(\d{1,2})[- ]day\s+)?(?:trip|itinerary|vacation|holiday|visit)\s+(?:to|in|for)\s+(.+?)(?:\s+for\s+(\d{1,2})\s+days?)?\s*[.!?]?$/iu;
const INVITE = /(?:กัน|ดี)\s*(?:ไหม|มั้ย|ป่ะ|ปะ|เปล่า)\s*[?!.]*\s*$/u;
const QUESTION_DEST = /^(?:ไหน|ที่ไหน|ยังไง|อย่างไร|อะไร|ดี)|ไหนดี|ยังไง|อย่างไร|อะไรดี|ที่ไหน|ถึงไหน|เสร็จ|แล้วหรือยัง/u;
const COMPANY = String.raw`(?:แฟน|ครอบครัว|เพื่อน|ลูก|พ่อ|แม่|ที่บ้าน|คนรัก|ภรรยา|สามี|เด็ก)`;
const DEST_STOP = new RegExp(String.raw`(?:\s*\d|\s+(?:วัน|คืน|ไป|กับ)|งบ|ช่วงเดือน|ช่วง|เดือน|ตอน(?!ใต้|เหนือ|กลาง|บน|ล่าง)|สำหรับ|ให้หน่อย|หน่อย|ด้วย|ได้ไหม|ได้มั้ย|ครับ|ค่ะ|คะ|นะ(?=\s|$)|แบบ|สไตล์|เน้น|ประมาณ|ราว|ไม่เกิน|กับ${COMPANY}|คนเดียว|สุดสัปดาห์|เสาร์\s*อาทิตย์|วันเดียว|ปีใหม่|สงกรานต์|หน้า(?:ฝน|หนาว|ร้อน)|จาก|โดย|ขับรถ|นั่งรถ|นั่งเครื่อง|ทริป|[,.!?()]|$)`, 'u');
const LEADING = /^(?:\s*(?:ไปยัง|ไป(?:ทำบุญ|ไหว้พระ|พักผ่อน|กิน)?|ที่(?!ไหน)|ใน|แถว|ณ|เที่ยว|ท่องเที่ยว|ทริป|ทัวร์|ประเทศ|จังหวัด|เมือง|to|ให้(?:กับ)?\s*(?:คุณ)?(?:พ่อ\s*แม่|พ่อ|แม่|ครอบครัว|แฟน|เพื่อน|ลูก|ผม|ฉัน|เรา|หนู|ที่บ้าน|ทีม|บริษัท)?)\s*)+/iu;
// Places looked for in the whole message when the words after "วางแผนเที่ยว" name none ("จัดทริปให้พ่อแม่ไปทำบุญ 9 วัด กรุงเทพ 1 วัน").
const PLACES = ('กรุงเทพ|เชียงใหม่|เชียงราย|น่าน|แพร่|ลำปาง|ลำพูน|แม่ฮ่องสอน|ปาย|พะเยา|อุตรดิตถ์|สุโขทัย|พิษณุโลก|เพชรบูรณ์|เขาค้อ|ตาก|กำแพงเพชร|นครสวรรค์|อุทัยธานี|'
  + 'ชัยนาท|ลพบุรี|สระบุรี|สิงห์บุรี|อ่างทอง|อยุธยา|สุพรรณบุรี|นครปฐม|นนทบุรี|ปทุมธานี|สมุทรปราการ|สมุทรสาคร|สมุทรสงคราม|อัมพวา|ราชบุรี|กาญจนบุรี|เพชรบุรี|ชะอำ|'
  + 'ประจวบคีรีขันธ์|หัวหิน|ปราณบุรี|ชุมพร|ระนอง|สุราษฎร์ธานี|เกาะสมุย|เกาะพะงัน|เกาะเต่า|กระบี่|เกาะลันตา|พังงา|เขาหลัก|ภูเก็ต|นครศรีธรรมราช|ตรัง|พัทลุง|สงขลา|หาดใหญ่|'
  + 'สตูล|เกาะหลีเป๊ะ|ปัตตานี|ยะลา|เบตง|นราธิวาส|ชลบุรี|พัทยา|บางแสน|เกาะล้าน|ระยอง|เกาะเสม็ด|จันทบุรี|ตราด|เกาะช้าง|เกาะกูด|ฉะเชิงเทรา|ปราจีนบุรี|นครนายก|สระแก้ว|'
  + 'เขาใหญ่|นครราชสีมา|โคราช|บุรีรัมย์|สุรินทร์|ศรีสะเกษ|อุบลราชธานี|ยโสธร|อำนาจเจริญ|มุกดาหาร|นครพนม|สกลนคร|อุดรธานี|หนองคาย|บึงกาฬ|เลย|เชียงคาน|ภูเรือ|หนองบัวลำภู|'
  + 'ขอนแก่น|ชัยภูมิ|มหาสารคาม|ร้อยเอ็ด|กาฬสินธุ์|ญี่ปุ่น|โตเกียว|โอซาก้า|เกียวโต|ฮอกไกโด|ซัปโปโร|ฟุกุโอกะ|นาโกย่า|โอกินาวา|เกาหลี|โซล|ปูซาน|เชจู|จีน|ปักกิ่ง|เซี่ยงไฮ้|'
  + 'เฉิงตู|ฉงชิ่ง|คุนหมิง|ลี่เจียง|จางเจียเจี้ย|ไต้หวัน|ไทเป|ฮ่องกง|มาเก๊า|สิงคโปร์|มาเลเซีย|กัวลาลัมเปอร์|ปีนัง|เวียดนาม|ฮานอย|โฮจิมินห์|ดานัง|ฮอยอัน|ดาลัด|ซาปา|'
  + 'ลาว|หลวงพระบาง|เวียงจันทน์|วังเวียง|กัมพูชา|เสียมเรียบ|พม่า|ย่างกุ้ง|อินเดีย|เนปาล|ภูฏาน|บาหลี|อินโดนีเซีย|ฟิลิปปินส์|มัลดีฟส์|ดูไบ|ตุรกี|จอร์เจีย|ยุโรป|อังกฤษ|ลอนดอน|'
  + 'ฝรั่งเศส|ปารีส|อิตาลี|สวิตเซอร์แลนด์|สวิส|เยอรมนี|ออสเตรเลีย|นิวซีแลนด์|อเมริกา|แคนาดา').split('|').sort((a, b) => b.length - a.length);
const placeIn = (text) => PLACES.find((p) => text.includes(p)) ?? null;
const MONTHS = [['มกรา(?:คม)?|ม\\.ค\\.', 'มกราคม'], ['กุมภา(?:พันธ์)?|ก\\.พ\\.', 'กุมภาพันธ์'], ['มีนา(?:คม)?|มี\\.ค\\.', 'มีนาคม'], ['เมษา(?:ยน)?|เม\\.ย\\.', 'เมษายน'],
  ['พฤษภา(?:คม)?|พ\\.ค\\.', 'พฤษภาคม'], ['มิถุนา(?:ยน)?|มิ\\.ย\\.', 'มิถุนายน'], ['กรกฎา(?:คม)?|ก\\.ค\\.', 'กรกฎาคม'], ['สิงหา(?:คม)?|ส\\.ค\\.', 'สิงหาคม'],
  ['กันยา(?:ยน)?|ก\\.ย\\.', 'กันยายน'], ['ตุลา(?:คม)?|ต\\.ค\\.', 'ตุลาคม'], ['พฤศจิกา(?:ยน)?|พ\\.ย\\.', 'พฤศจิกายน'], ['ธันวา(?:คม)?|ธ\\.ค\\.', 'ธันวาคม']];
const STYLES = [[/สาย\s*กิน|ของกิน|ของอร่อย|ร้านอร่อย/u, 'เน้นของกิน'], [/คาเฟ่|cafe/iu, 'คาเฟ่'], [/ธรรมชาติ|ภูเขา|ดอย|น้ำตก|เดินป่า|แคมป์/u, 'ธรรมชาติ'],
  [/ทะเล|ชายหาด|เกาะ|ดำน้ำ/u, 'ทะเล'], [/ไหว้พระ|ทำบุญ|สายมู|ขอพร/u, 'ไหว้พระ'], [/ช้อป|ช็อป|ชอป|shopping/iu, 'ช้อปปิ้ง'], [/ครอบครัว|เด็ก|ผู้สูงอายุ|พ่อแม่/u, 'ครอบครัว'],
  [/ประหยัด|งบน้อย|แบ็คแพ็ค|backpack/iu, 'ประหยัด'], [/หรู|luxury|ลักชัวรี/iu, 'หรูหรา'], [/ถ่ายรูป|ถ่ายภาพ/u, 'ถ่ายรูป'], [/ประวัติศาสตร์|พิพิธภัณฑ์|โบราณสถาน/u, 'ประวัติศาสตร์'],
  [/ขับรถ|รถส่วนตัว|โรดทริป|road\s*trip/iu, 'ขับรถเที่ยว']];
const UNIT = { k: 1000, พัน: 1000, หมื่น: 10000, แสน: 100000 };

/** The destination text of a trip request, cleaned: "ไปเที่ยวญี่ปุ่น 5 วัน" → "ญี่ปุ่น". */
function destinationOf(rest) {
  let d = String(rest ?? '').replace(LEADING, '');
  const stop = d.search(DEST_STOP);
  if (stop >= 0) d = d.slice(0, stop);
  return d.replace(/\s+/gu, ' ').replace(/[-–:：]+$/u, '').trim().slice(0, 40);
}

/**
 * {destination, days, nights, daysGuessed, budget, perPerson, people, when, style[], from} of a "plan my trip" request,
 * {missing: 'destination'} when it names no place, or null (not a trip request, or a question like "เที่ยวไหนดี").
 */
export function tripAsk(input) {
  const text = arabic(input).replace(/\s+/gu, ' ').trim();
  if (!text || INVITE.test(text)) return null;
  let destination, enDays = null, m;
  if ((m = text.match(ASK_EN))) { destination = m[2].replace(/\s+(?:with|on|in|during|under|for)\b.*$/iu, '').trim(); enDays = Number(m[1] ?? m[3]) || null; }
  else if ((m = text.match(ASK_THEN))) destination = destinationOf(m[1]);
  else if ((m = text.match(ASK_TH))) destination = destinationOf(m[1]);
  else return null;
  if (destination && QUESTION_DEST.test(destination)) return null;
  if (!destination || destination.length < 2) destination = placeIn(text);
  if (!destination) return { missing: 'destination' };

  let days = Number(text.match(/(\d{1,2})\s*วัน(?!ที่)/u)?.[1] ?? text.match(/(\d{1,2})\s*d\s*\d{1,2}\s*n\b/iu)?.[1] ?? enDays ?? 0) || null;
  let nights = Number(text.match(/(\d{1,2})\s*คืน/u)?.[1] ?? text.match(/\d{1,2}\s*d\s*(\d{1,2})\s*n\b/iu)?.[1] ?? NaN);
  if (!days && /วันเดียว|เช้า\s*เย็น\s*กลับ|one[- ]day|day\s*trip/iu.test(text)) { days = 1; nights = 0; }
  if (!days && /สุดสัปดาห์|เสาร์\s*-?\s*อาทิตย์|weekend/iu.test(text)) { days = 2; nights = Number.isFinite(nights) ? nights : 1; }
  if (!days && Number.isFinite(nights) && nights > 0) days = nights + 1;
  const daysGuessed = !days, daysAsked = days && days > MAX_DAYS ? days : null;
  days = Math.min(MAX_DAYS, Math.max(1, days ?? 3));
  if (!Number.isFinite(nights) || nights >= days + 1 || nights < 0) nights = Math.max(0, days - 1);

  let budget = null, perPerson = false;
  const b = text.match(/งบ(?:ประมาณ)?\s*(?:ทั้งหมด|รวม|ทั้งทริป)?\s*(คนละ|ต่อคน)?\s*(?:ประมาณ|ราว|ไม่เกิน|แค่)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|พัน|หมื่น|แสน)?/iu)
    ?? text.match(/(คนละ)\s*(\d[\d,]*(?:\.\d+)?)\s*(k|พัน|หมื่น|แสน)?\s*(?:บาท)?/iu);
  if (b) {
    budget = Math.round(Number(b[2].replace(/,/g, '')) * (UNIT[(b[3] ?? '').toLowerCase()] ?? 1));
    perPerson = !!b[1] || /(?:คนละ|ต่อคน|\/\s*คน)/u.test(text.slice(b.index, b.index + b[0].length + 12));
    if (!(budget >= 100)) budget = null;
  }
  let people = Number(text.match(/(\d{1,2})\s*คน(?!ละ)/u)?.[1] ?? 0) || null;
  if (!people && /คนเดียว|solo/iu.test(text)) people = 1;
  if (!people && /(?:กับ|ไป)\s*(?:แฟน|คนรัก|ภรรยา|สามี)|คู่รัก|ฮันนีมูน/u.test(text)) people = 2;
  const month = MONTHS.find(([re]) => new RegExp(`(?:เดือน\\s*)?(?:${re})`, 'u').test(text))?.[1];
  const season = text.match(/ปีใหม่|สงกรานต์|ลอยกระทง|หน้า(?:ฝน|หนาว|ร้อน)|คริสต์มาส/u)?.[0];
  const when = month ?? (season ? `ช่วง${season}` : null);
  const style = STYLES.filter(([re]) => re.test(text)).map(([, s]) => s).filter((s) => !(s === 'ทะเล' && /ทะเล/u.test(destination))).slice(0, 4);
  const from = text.match(/จาก\s*(กรุงเทพ(?:ฯ|มหานคร)?|กทม\.?|[ก-๙A-Za-z]{2,20})/u)?.[1] ?? null;
  return { destination, days, nights, daysGuessed, daysAsked, budget, perPerson, people, when, style, from };
}

export const tripLength = (req) => (req.days === 1 ? 'วันเดียว' : `${req.days} วัน ${req.nights} คืน`);
export const tripLabel = (req) => `${req.destination} ${tripLength(req)}`;
export const tripTitle = (req) => `แผนเที่ยว${req.destination} ${tripLength(req)}`;

/** Fixed searches: what to see, a plan of this length, where to eat, what things cost (+ the style or season). */
export function tripQueries(req) {
  const d = /^[A-Za-z]/.test(req.destination) ? ` ${req.destination}` : req.destination; // "ที่เที่ยว Tokyo", "ที่เที่ยวเชียงใหม่"
  const q = [`ที่เที่ยว${d} ยอดนิยม`, `เที่ยว${d} ${tripLength(req)}`, `ร้านอาหาร${d} แนะนำ`, `ค่าใช้จ่าย เที่ยว${d} ราคา`];
  if (req.style?.length) q.push(`เที่ยว${d} ${req.style[0]}`);
  else if (req.when) q.push(`เที่ยว${d} ${req.when}`);
  return q;
}

// ---- writing the plan ---------------------------------------------------------------------------------------
const SLOTS = ['เช้า', 'สาย', 'กลางวัน', 'เที่ยง', 'บ่าย', 'เย็น', 'ค่ำ', 'กลางคืน'];
const FREE = /เวลาอิสระ|อิสระ|ตามอัธยาศัย|พักผ่อน|เดินทาง|เช็[คก]\s*อิน|เช็[คก]\s*เอา[ทต]์?|check.?in|check.?out|กลับ(?:ที่พัก|โรงแรม|บ้าน|กรุงเทพ)|ถึง(?:ที่พัก|โรงแรม|สนามบิน)|เข้าที่พัก|นอน|ไปสนามบิน/iu;
const sourceBlock = (sources) => sources.map((s, i) => `[${i + 1}] ${s.title || s.url} — ${s.url}${s.publishedAt ? ` (${String(s.publishedAt).slice(0, 10)})` : ''}\n${s.text}`).join('\n\n');

/** The days each model call writes: up to 4, split evenly (7 days → 1–4, 5–7). */
export function dayChunks(days) {
  const n = Math.ceil(days / DAYS_PER_CALL), size = Math.ceil(days / n), out = [];
  for (let from = 1; from <= days; from += size) out.push({ from, to: Math.min(days, from + size - 1) });
  return out.map((c, i) => ({ ...c, first: i === 0, last: i === out.length - 1 }));
}

function rulesFor(part) {
  const day = '## วันที่ <n>: <short theme>\n- เช้า: <place or activity> [n]\n- กลางวัน: <where or what to eat> [n]\n- บ่าย: <place or activity> [n]\n- เย็น: <place, food or activity> [n]\n';
  return 'You plan a trip in Thai using ONLY the places, food and prices found in the numbered sources. Format exactly:\n'
    + (part.first ? 'สรุป: <1–2 sentences about the plan>\n' : '')
    + `${day}(one such section for each day asked)\n`
    + (part.last ? '## งบประมาณ\n- <item>: <price exactly as the source writes it> [n]\n## เคล็ดลับ\n- <one tip per line> [n]\n' : '')
    + 'Rules: every place, restaurant and price must come from the source you cite with [n]. End every line with [n], except free time or travel lines (เวลาอิสระ, พักผ่อน, เดินทาง, เช็กอิน). '
    + 'Copy prices and numbers exactly as the source writes them; never add up or estimate prices. No clock times. Keep each day\'s places near each other, and never repeat a place. Output only the plan.';
}
function requestBlock(req, part, used = [], today = thaiToday()) {
  return [`ปลายทาง: ${req.destination}`, `ทั้งทริป: ${tripLength(req)}`, req.when ? `ช่วงเวลา: ${req.when}` : '',
    req.budget ? `งบ: ${req.budget.toLocaleString('en-US')} บาท${req.perPerson ? ' ต่อคน' : ' ทั้งทริป'}` : '', req.people ? `ผู้เดินทาง: ${req.people} คน` : '',
    req.style?.length ? `สไตล์: ${req.style.join(', ')}` : '', req.from ? `เดินทางจาก: ${req.from}` : '',
    `เขียนเฉพาะ: วันที่ ${part.from}${part.to > part.from ? ` ถึง ${part.to}` : ''}${part.last ? ' + งบประมาณ + เคล็ดลับ' : ''}`,
    used.length ? `ห้ามซ้ำกับที่วางไว้แล้ว: ${used.slice(-24).join(', ')}` : '', `วันนี้: ${today}`].filter(Boolean).join('\n');
}
export const planMessages = (req, sources, part, used = [], today = thaiToday()) => [
  { role: 'system', content: rulesFor(part) },
  { role: 'user', content: `${requestBlock(req, part, used, today)}\n\nแหล่งข้อมูล:\n${sourceBlock(sources)}` },
];
export const revisePlanMessages = (text, failing, req, sources, part, used = [], today = thaiToday()) => [
  { role: 'system', content: rulesFor(part) },
  { role: 'user', content: `แผนส่วนนี้มีบรรทัดที่ตรวจกับแหล่งแล้วไม่ผ่าน:\n${failing.map((r) => `- "${r.raw}": ${r.problems.join('; ')}`).join('\n')}\n`
    + `แก้เฉพาะบรรทัดเหล่านี้ให้ตรงกับแหล่ง (ใช้สถานที่และราคาที่มีอยู่จริงในแหล่งที่อ้าง หรือแก้เลขแหล่งให้ถูก) หรือเปลี่ยนเป็นเวลาอิสระ แล้วส่งแผนส่วนนี้กลับมาทั้งส่วนในรูปแบบเดิม\n\nแผน:\n${text}\n\n${requestBlock(req, part, used, today)}\n\nแหล่งข้อมูล:\n${sourceBlock(sources)}` },
];

// ---- reading and checking the plan --------------------------------------------------------------------------
const DAY_HEAD = /^(?:#{1,4}\s*)?(?:\*\*)?\s*(?:วัน(?:ที่)?|day)\s*(\d{1,2})(?!\d)\s*(?:\*\*)?\s*(?:[:：\-–—(]\s*)?(.*?)\)?\s*(?:\*\*)?\s*$/iu;
const BUDGET_HEAD = /^(?:#{1,4}\s*)?(?:\*\*)?\s*(?:งบประมาณ|ค่าใช้จ่าย|budget)(?:[\s:：(*]|$)/iu;
const TIPS_HEAD = /^(?:#{1,4}\s*)?(?:\*\*)?\s*(?:เคล็ดลับ|ข้อแนะนำ|คำแนะนำ|tips?)(?:[\s:：(*]|$)/iu;
const ITEM = /^\s*(?:[-•*]|\d{1,2}[.)])\s+(.+)$/u;
const SLOT_RE = new RegExp(`^(?:\\*\\*)?(${SLOTS.join('|')})(?:\\*\\*)?\\s*(?:[:：\\-–—]\\s*|\\s+)(.+)$`, 'u');
const CITE = /\s*\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/gu;

/** The model text without <think>, code fences or bold marks around whole lines. */
export const cleanPlan = (text) => String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^```\w*\s*$/gim, '').trim();

/** {summary, days: [{n, theme, items: [{slot, text, cites, raw}]}], budget: [...], tips: [...]} (cites within 1..count). */
export function parsePlan(text, count) {
  const plan = { summary: '', days: [], budget: [], tips: [] };
  let section = null;
  for (const raw of cleanPlan(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const summary = line.replace(/\*\*/g, '').match(/^สรุป\s*[:：]\s*(.+)$/u);
    if (summary && !section) { plan.summary = summary[1].trim(); continue; }
    if (!ITEM.test(line) || /^#/.test(line)) {
      const day = line.match(DAY_HEAD);
      if (day) { section = { n: Number(day[1]), theme: day[2].replace(/\*\*/g, '').replace(/^[(:：\s]+|[)\s]+$/g, '').trim(), items: [] }; plan.days.push(section); continue; }
      if (BUDGET_HEAD.test(line)) { section = plan.budget; continue; }
      if (TIPS_HEAD.test(line)) { section = plan.tips; continue; }
      if (!ITEM.test(line)) continue; // an intro or closing line
    }
    if (!section) continue;
    let body = line.match(ITEM)[1].replace(/\*\*/g, '').trim();
    const cites = [...new Set([...body.matchAll(CITE)].flatMap((m) => m[1].split(',').map(Number)).filter((n) => n >= 1 && n <= count))];
    body = body.replace(CITE, '').replace(/\s+/gu, ' ').trim();
    const item = { slot: '', text: body, cites, raw: line.replace(/^\s*(?:[-•*]|\d{1,2}[.)])\s+/u, '') };
    if (Array.isArray(section)) { section.push(item); continue; }
    const slot = body.match(SLOT_RE);
    if (slot) { item.slot = slot[1]; item.text = slot[2].trim(); }
    section.items.push(item);
  }
  return plan;
}

const CLOCK = /\d{1,2}:\d{2}(?:\s*(?:น\.?|นาฬิกา|am|pm))?|\d{1,2}\.\d{2}\s*(?:น\.|นาฬิกา)/giu;
/** Numbers that may appear without a source: the request's own (days, nights, budget, people) and this or next year. */
export function allowedNumbers(req, now = Date.now()) {
  const year = new Date(now + 7 * 3_600_000).getUTCFullYear();
  return new Set([req.days, req.nights, req.budget, req.people, year, year + 1, year + 543, year + 544].filter((n) => n != null).map(String));
}
const numbersOf = (text, allowed) => numbersIn(String(text).replace(CLOCK, ' ')).filter((n) => !allowed.has(n.replace(/,/g, '')));

// Words that name no place: taken out before looking for the place name in the source.
const GENERIC = ['เดินเล่น', 'เที่ยวชม', 'ถ่ายรูป', 'เช็คอิน', 'เช็กอิน', 'ช้อปปิ้ง', 'ช็อปปิ้ง', 'ชอปปิ้ง', 'ซื้อของฝาก', 'ซื้อของ', 'ของฝาก', 'รับประทาน', 'ทานอาหาร',
  'อาหารกลางวัน', 'อาหารเย็น', 'อาหารเช้า', 'อาหารค่ำ', 'มื้อกลางวัน', 'มื้อเที่ยง', 'มื้อเย็น', 'มื้อค่ำ', 'ร้านอาหาร', 'อาหาร', 'กินข้าว', 'ร้าน', 'ไหว้พระ', 'ทำบุญ',
  'นั่งชิล', 'ชิล', 'พักผ่อน', 'ที่พัก', 'โรงแรม', 'เดินทาง', 'ไปยัง', 'ไปที่', 'แวะชม', 'แวะ', 'ชมวิว', 'ชม', 'เที่ยว', 'ลองชิม', 'ชิม', 'สัมผัส', 'บรรยากาศ', 'ยามเย็น',
  'ยามค่ำ', 'พระอาทิตย์ตก', 'พระอาทิตย์ขึ้น', 'ขึ้นชื่อ', 'ยอดนิยม', 'ชื่อดัง', 'อร่อย', 'สวยงาม', 'ภายใน', 'บริเวณ', 'ย่าน', 'แถว', 'เมนู', 'ที่', 'และ', 'กับ', 'หรือ', 'ณ', 'รอบ']
  .sort((a, b) => b.length - a.length);
const flat = (s) => String(s ?? '').toLowerCase().replace(/[\s​]+/gu, '');
/** Does part of the place name (5 characters in a row, or a whole short name) appear in the source text? */
export function namedIn(text, pool) {
  let t = flat(text).replace(/\([^)]*\)/g, '|');
  for (const w of GENERIC) t = t.split(w).join('|');
  const parts = t.split(/[|,/:：;"“”'‘’.!?\-–—]+/u).filter((p) => p.length >= 3);
  if (!parts.length) return true; // only generic words ("ช้อปปิ้ง"): nothing to look for
  const hay = flat(pool);
  return parts.some((p) => { const size = Math.min(5, p.length); for (let i = 0; i + size <= p.length; i++) if (hay.includes(p.slice(i, i + size))) return true; return false; });
}

const sourceText = (s) => `${s.title} ${s.text}`;
/** One row per item: {section, day, item, problems}. */
export function checkPlan(plan, sources, allowed = new Set()) {
  const rows = [], all = sources.map(sourceText).join('\n');
  const pool = (cites) => cites.map((n) => sourceText(sources[n - 1])).join('\n');
  const numbers = (item, needCite) => {
    const nums = numbersOf(item.text, allowed);
    if (!nums.length) return [];
    if (!item.cites.length) return needCite ? [] : [`มีตัวเลข ${nums.join(', ')} แต่ไม่มีเลขแหล่ง [n]`];
    const p = pool(item.cites);
    return nums.filter((n) => !numberIn(n, p)).map((n) => `ตัวเลข ${n} ไม่มีในแหล่ง ${item.cites.map((c) => `[${c}]`).join('')}`);
  };
  for (const day of plan.days) {
    for (const item of day.items) {
      const problems = [], free = FREE.test(item.text) && item.text.length <= 60;
      if (!item.cites.length && !free) problems.push('ไม่มีเลขแหล่ง [n] ท้ายบรรทัด');
      problems.push(...numbers(item, !free));
      if (item.cites.length && !free && !namedIn(item.text, pool(item.cites))) problems.push(`ชื่อสถานที่ไม่มีในแหล่ง ${item.cites.map((c) => `[${c}]`).join('')}`);
      rows.push({ section: 'day', day: day.n, item, raw: item.raw, problems });
    }
  }
  for (const item of plan.budget) {
    const problems = [];
    if (!item.cites.length) problems.push('ราคาไม่มีเลขแหล่ง [n]');
    else if (!numbersOf(item.text, new Set()).length) problems.push('ไม่มีราคา');
    problems.push(...numbers(item, true));
    rows.push({ section: 'budget', item, raw: item.raw, problems });
  }
  for (const item of plan.tips) rows.push({ section: 'tips', item, raw: item.raw, problems: numbers(item, false) });
  if (plan.summary) {
    const bad = numbersOf(plan.summary, allowed).filter((n) => !numberIn(n, all));
    if (bad.length) rows.push({ section: 'summary', item: { text: plan.summary, cites: [] }, raw: `สรุป: ${plan.summary}`, problems: bad.map((n) => `ตัวเลข ${n} ไม่มีในแหล่ง`) });
  }
  return rows;
}

const key = (text) => flat(text).replace(/[()[\],.]/g, '');
/** The plan without failing rows; days outside the part are dropped (renumbered when the model started again at 1). */
export function keepPlan(plan, rows, part, used = new Set()) {
  const bad = new Set(rows.filter((r) => r.problems.length).map((r) => r.item));
  const removed = rows.filter((r) => r.problems.length).map((r) => ({ line: r.raw, problems: r.problems }));
  let days = plan.days;
  if (days.length && !days.some((d) => d.n >= part.from && d.n <= part.to)) days = days.map((d, i) => ({ ...d, n: part.from + i }));
  const out = { summary: bad.has(rows.find((r) => r.section === 'summary')?.item) ? '' : plan.summary, days: [], budget: [], tips: [] };
  for (const day of days) {
    if (day.n < part.from || day.n > part.to || out.days.some((d) => d.n === day.n)) continue;
    const items = [];
    for (const item of day.items) {
      if (bad.has(item)) continue;
      const k = key(item.text);
      if (item.cites.length && used.has(k)) { removed.push({ line: item.raw, problems: ['ซ้ำกับที่วางไว้แล้ว'] }); continue; }
      if (item.cites.length) used.add(k);
      items.push({ slot: item.slot, text: item.text, cites: item.cites, free: !item.cites.length });
    }
    out.days.push({ n: day.n, theme: day.theme, items });
  }
  if (part.last) {
    out.budget = plan.budget.filter((i) => !bad.has(i)).map(({ text, cites }) => ({ text, cites }));
    out.tips = plan.tips.filter((i) => !bad.has(i)).map(({ text, cites }) => ({ text, cites }));
  }
  return { plan: out, removed };
}

/**
 * Plans the trip. ask(messages, params) → model text; search(query) → web results. Returns {status: 'ready' |
 * 'not-enough', plan, sources, queries, removed, revised, checked}; throws when cancelled.
 */
export async function runTrip({ req, ask, search, onStep = () => {}, signal, today = thaiToday(), now = Date.now() }) {
  const step = (s) => { signal?.throwIfAborted(); onStep(s); };
  const queries = tripQueries(req), lists = [];
  for (const [i, q] of queries.entries()) {
    step({ stage: 'search', text: `ค้นเว็บ ${i + 1}/${queries.length}: ${q}`, query: q });
    lists.push(await search(q).catch(() => []));
  }
  signal?.throwIfAborted();
  const sources = collectSources(lists, MAX_TRIP_SOURCES);
  if (sources.length < 3) return { status: 'not-enough', reason: `เจอแหล่งที่ใช้ได้แค่ ${sources.length} แหล่ง`, queries, sources, removed: [] };
  const allowed = allowedNumbers(req, now), plan = { summary: '', days: [], budget: [], tips: [] }, removed = [], used = new Set(), usedNames = [];
  let revised = false;
  const parts = dayChunks(req.days);
  for (const part of parts) {
    step({ stage: 'write', text: parts.length > 1 ? `วางแผนวันที่ ${part.from}–${part.to} จาก ${sources.length} แหล่ง` : `วางแผน ${tripLength(req)} จาก ${sources.length} แหล่ง` });
    const maxTokens = (part.to - part.from + 1) * 240 + (part.first ? 100 : 0) + (part.last ? 380 : 0);
    let text = cleanPlan(await ask(planMessages(req, sources, part, usedNames, today), { maxTokens, temperature: 0.4 }));
    let parsed = parsePlan(text, sources.length), rows = checkPlan(parsed, sources, allowed);
    const failing = rows.filter((r) => r.problems.length);
    if (failing.length) {
      step({ stage: 'check', text: `ตรวจกับแหล่งแล้วไม่ผ่าน ${failing.length} บรรทัด: ให้แก้ 1 รอบ` });
      const fixedText = cleanPlan(await ask(revisePlanMessages(text, failing, req, sources, part, usedNames, today), { maxTokens, temperature: 0.2 }));
      const fixed = parsePlan(fixedText, sources.length);
      if (fixed.days.length && fixed.days.length >= parsed.days.length) { text = fixedText; parsed = fixed; rows = checkPlan(parsed, sources, allowed); revised = true; }
    } else step({ stage: 'check', text: 'ตรวจกับแหล่งแล้วผ่านทุกบรรทัด' });
    const kept = keepPlan(parsed, rows, part, used);
    removed.push(...kept.removed);
    if (part.first) plan.summary = kept.plan.summary;
    plan.days.push(...kept.plan.days);
    if (part.last) { plan.budget = kept.plan.budget; plan.tips = kept.plan.tips; }
    usedNames.push(...kept.plan.days.flatMap((d) => d.items.filter((i) => i.cites.length).map((i) => i.text.slice(0, 40))));
  }
  for (let n = 1; n <= req.days; n++) if (!plan.days.some((d) => d.n === n)) plan.days.push({ n, theme: '', items: [] });
  plan.days.sort((a, b) => a.n - b.n);
  for (const day of plan.days) {
    if (!day.items.some((i) => i.cites.length)) day.theme = '';
    if (!day.items.length) day.items.push({ slot: '', text: 'เวลาอิสระ (แหล่งที่ค้นได้ยังไม่พอให้วางกิจกรรมวันนี้)', cites: [], free: true });
  }
  const checked = plan.days.reduce((n, d) => n + d.items.filter((i) => i.cites.length).length, 0) + plan.budget.length;
  if (checked < (req.days === 1 ? 2 : 3)) return { status: 'not-enough', reason: `ได้กิจกรรมที่ตรวจกับแหล่งผ่านแค่ ${checked} รายการ`, queries, sources, removed, revised };
  if (!plan.summary) plan.summary = `${tripTitle(req)} จากที่เที่ยว ร้านอาหาร และราคาที่มีใน ${sources.length} แหล่ง`;
  return { status: 'ready', plan, sources, queries, removed, revised, checked };
}

// ---- output -------------------------------------------------------------------------------------------------
const marks = (cites) => cites.map((c) => `[${c}]`).join('');
const itemLine = (i) => `${i.slot ? `${i.slot}: ` : ''}${i.text}${i.cites.length ? ` ${marks(i.cites)}` : ''}`;

/** Word blocks for the plan (docxOut.mjs). */
export function tripBlocks(req, r, today = thaiToday()) {
  const info = [['ปลายทาง', req.destination], ['ระยะเวลา', tripLength(req)]];
  if (req.when) info.push(['ช่วงเวลา', req.when]);
  if (req.budget) info.push(['งบที่ตั้งไว้', `${req.budget.toLocaleString('en-US')} บาท${req.perPerson ? ' ต่อคน' : ' ทั้งทริป'}`]);
  if (req.people) info.push(['ผู้เดินทาง', `${req.people} คน`]);
  if (req.style?.length) info.push(['สไตล์', req.style.join(', ')]);
  if (req.from) info.push(['เดินทางจาก', req.from]);
  const blocks = [
    { type: 'note', text: `ทำโดย Lumicos ${today} · สถานที่ ร้าน และราคาทุกบรรทัดมาจากแหล่งที่อ้าง [n] (ตรวจตัวเลขกับแหล่งแล้ว) · ราคา เวลาเปิดปิด และการเดินทางอาจเปลี่ยน ควรเช็กก่อนไป` },
    { type: 'table', rows: info, header: false, widths: [28, 72] },
    { type: 'paragraph', text: r.plan.summary },
  ];
  for (const day of r.plan.days) {
    blocks.push({ type: 'heading', level: 2, text: `วันที่ ${day.n}${day.theme ? `: ${day.theme}` : ''}` });
    blocks.push({ type: 'table', rows: [['ช่วง', 'กิจกรรม', 'แหล่ง'], ...day.items.map((i) => [i.slot || '-', i.text, marks(i.cites) || '-'])], widths: [14, 72, 14] });
  }
  if (r.plan.budget.length) {
    blocks.push({ type: 'heading', level: 2, text: 'ราคาจากแหล่ง (สำหรับคิดงบ)' });
    blocks.push({ type: 'table', rows: [['รายการ', 'แหล่ง'], ...r.plan.budget.map((i) => [i.text, marks(i.cites)])], widths: [86, 14] });
    blocks.push({ type: 'note', text: 'เป็นราคาตามที่แหล่งเขียนไว้ ยังไม่ได้รวมเป็นยอดเดียว เพราะแต่ละรายการคิดต่อคน ต่อคืน หรือต่อครั้งต่างกัน' });
  }
  if (r.plan.tips.length) blocks.push({ type: 'heading', level: 2, text: 'เคล็ดลับ' }, { type: 'bullets', items: r.plan.tips.map((i) => `${i.text}${i.cites.length ? ` ${marks(i.cites)}` : ''}`) });
  blocks.push({ type: 'heading', level: 2, text: 'แหล่งข้อมูล' }, { type: 'links', items: r.sources.map((s) => ({ title: s.title, url: s.url })) });
  return blocks;
}

/** The chat text for a finished plan ([n] marks are the message's sources E1… in order). */
export function tripReport(req, r, file, sheet) {
  if (r.status !== 'ready') return `ค้นเรื่องเที่ยว${req.destination}แล้ว แต่ยังวางแผนไม่ได้: ${r.reason}\nลองระบุปลายทางให้ชัดขึ้น เช่น ชื่อจังหวัดหรือเมือง แล้วสั่งใหม่ได้`;
  const lines = [`${tripTitle(req)} เสร็จแล้ว`, file ? `ไฟล์ Word: ${file}` : null, sheet ? `ไฟล์ Excel (ชีตละวัน ยอดรวมคำนวณให้ แก้จำนวนคนได้): ${sheet}` : null, r.plan.summary, ''].filter((l) => l !== null);
  for (const day of r.plan.days) lines.push(`วันที่ ${day.n}${day.theme ? `: ${day.theme}` : ''}`, ...day.items.map((i) => `• ${itemLine(i)}`), '');
  if (r.plan.budget.length) lines.push('ราคาจากแหล่ง:', ...r.plan.budget.map((i) => `• ${i.text} ${marks(i.cites)}`), '');
  lines.push(`(ตรวจชื่อสถานที่และตัวเลขกับแหล่งแล้ว ${r.checked} รายการ จาก ${r.sources.length} แหล่ง${r.removed?.length ? ` · ตัดออก ${r.removed.length} บรรทัดที่ตรวจไม่ผ่าน` : ''})`);
  if (req.daysGuessed) lines.push('ไม่ได้บอกจำนวนวัน เลยวางไว้ 3 วัน 2 คืน ถ้าจะเปลี่ยน สั่งใหม่พร้อมจำนวนวันได้');
  if (req.daysAsked) lines.push(`วางแผนได้ครั้งละไม่เกิน ${MAX_DAYS} วัน เลยวางไว้ ${MAX_DAYS} วันแรกจาก ${req.daysAsked} วัน`);
  return lines.filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== '')).join('\n').trim();
}

// ---- Excel (claude-20261025, user sent their own Japan itinerary: "ทำแบบนี้ ปรับปรุงให้ดีขึ้นอีกนิด") ----------------
// The same layout as the user's sheet: a sheet per day (time, detail, cost, total, note), plus a summary with one cell
// for the number of people, totals by formula, and the prices the sources give.
const PRICE = /(\d[\d,]*(?:\.\d+)?)\s*(?:-|–|ถึง)?\s*(?:\d[\d,]*(?:\.\d+)?)?\s*บาท/u;
/** {price, perGroup, from} of a line that states a baht price ("ค่าเข้า 50 บาท", "คืนละ 800-1,200 บาท"), or null. */
export function priceOf(text) {
  const m = String(text ?? '').match(PRICE);
  if (!m) return null;
  const price = Number(m[1].replace(/,/g, ''));
  if (!(price > 0)) return null;
  return { price, perGroup: /คืนละ|ต่อคืน|ต่อห้อง|ห้องละ|เหมา|ต่อคัน|คันละ/u.test(text), from: /[-–]|ถึง|เริ่มต้น/u.test(m[0]) || /เริ่มต้น/u.test(text) };
}
const catOf = (slot, text) => (/ที่พัก|โรงแรม|รีสอร์ท|คืนละ|ห้อง/u.test(text) ? 'ที่พัก' : /รถ|เรือ|ตั๋ว|เครื่องบิน|เดินทาง/u.test(text) ? 'เดินทาง'
  : /กลางวัน|เที่ยง|เย็น|ค่ำ/u.test(slot) && /ร้าน|ข้าว|อาหาร|กิน|ก๋วย|ซอย|ชาม|เมนู/u.test(text) ? 'อาหาร' : /ค่าเข้า|ค่ายาน|อุทยาน|ตั๋วเข้า/u.test(text) ? 'ค่าเข้า/กิจกรรม' : 'อื่น ๆ');
const TRIP_CATS = ['เดินทาง', 'ที่พัก', 'อาหาร', 'ค่าเข้า/กิจกรรม', 'อื่น ๆ'];

/** The plan as an .xlsx (Buffer). */
export async function tripXlsx(req, r, today = thaiToday()) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook(); wb.creator = 'Lumicos'; wb.calcProperties = { fullCalcOnLoad: true };
  const FONT = { name: 'Tahoma', size: 10 }, HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
  const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const box = { top: { style: 'thin', color: { argb: 'FFBFBFBF' } }, left: { style: 'thin', color: { argb: 'FFBFBFBF' } }, bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } }, right: { style: 'thin', color: { argb: 'FFBFBFBF' } } };
  const MONEY = '#,##0" ฿"', PEOPLE = "'สรุป'!$B$3";
  const head = (ws, row, titles) => titles.forEach((t, i) => { const c = ws.getCell(row, i + 1); c.value = t; c.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD; c.border = box; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  const sum = wb.addWorksheet('สรุป', { properties: { tabColor: { argb: 'FF2F5597' } } });
  const days = [];
  for (const day of r.plan.days) {
    const ws = wb.addWorksheet(`วันที่ ${day.n}`);
    ws.columns = [12, 12, 62, 14, 13, 11, 13, 15, 8, 30].map((width) => ({ width }));
    head(ws, 1, ['วัน', 'ช่วงเวลา', 'รายละเอียด', 'ประเภท', 'ราคา (บาท)', 'คิดราคา', 'ต่อคน (บาท)', 'รวมทุกคน (บาท)', 'แหล่ง', 'หมายเหตุ']);
    ws.getRow(1).height = 30; ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
    let row = 2;
    for (const item of day.items) {
      const p = item.cites.length ? priceOf(item.text) : null, cells = ws.getRow(row);
      cells.values = [row === 2 ? `วันที่ ${day.n}${day.theme ? `\n${day.theme}` : ''}` : null, item.slot || '-', item.text, p ? catOf(item.slot, item.text) : null,
        p?.price ?? null, p ? (p.perGroup ? 'ทั้งกลุ่ม' : 'ต่อคน') : null, null, null, item.cites.map((c) => `[${c}]`).join('') || null, p?.from ? 'ราคาเริ่มต้นตามแหล่ง' : null];
      if (p) {
        cells.getCell(7).value = { formula: `IF(E${row}="","",ROUND(IF(F${row}="ทั้งกลุ่ม",E${row}/${PEOPLE},E${row}),0))` };
        cells.getCell(8).value = { formula: `IF(G${row}="","",G${row}*${PEOPLE})` };
        for (const c of [5, 6, 7, 8]) cells.getCell(c).fill = fill('FFFFF8E1');
      }
      for (let c = 1; c <= 10; c++) { const cell = cells.getCell(c); cell.font = { ...FONT, bold: c === 2 }; cell.border = box; cell.alignment = { wrapText: true, vertical: 'top' }; }
      for (const c of [5, 7, 8]) cells.getCell(c).numFmt = MONEY;
      if (item.slot) cells.getCell(2).fill = fill('FFEEF3FB');
      row++;
    }
    const last = row - 1, tot = row + 1, t = ws.getRow(tot);
    t.getCell(3).value = 'รวมทั้งวัน'; t.getCell(6).value = 'ต่อคน →';
    t.getCell(7).value = { formula: `SUM(G2:G${last})` }; t.getCell(8).value = { formula: `SUM(H2:H${last})` };
    for (let c = 1; c <= 10; c++) { const cell = t.getCell(c); cell.fill = fill('FFDDEBF7'); cell.border = box; cell.font = { ...FONT, bold: true, size: 11 }; }
    for (const c of [7, 8]) t.getCell(c).numFmt = MONEY;
    ws.mergeCells(2, 1, last, 1); ws.getCell(2, 1).alignment = { vertical: 'top', wrapText: true }; ws.getCell(2, 1).font = { ...FONT, bold: true };
    ws.dataValidations.add(`F2:F${last + 20}`, { type: 'list', allowBlank: true, formulae: ['"ต่อคน,ทั้งกลุ่ม"'] });
    ws.dataValidations.add(`D2:D${last + 20}`, { type: 'list', allowBlank: true, formulae: [`"${TRIP_CATS.join(',')}"`] });
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' };
    days.push({ name: ws.name, tot, day });
  }
  // ---- summary ----
  sum.columns = [{ width: 30 }, { width: 14 }, { width: 18 }, { width: 16 }, { width: 60 }];
  sum.getCell('A1').value = tripTitle(req); sum.getCell('A1').font = { ...FONT, size: 16, bold: true };
  sum.getCell('A2').value = `ทำโดย Lumicos ${today} · สถานที่และราคามาจากแหล่งที่อ้าง [n] ในชีต "แหล่งข้อมูล" · ราคาอาจเปลี่ยน ควรเช็กก่อนไป`; sum.getCell('A2').font = { ...FONT, italic: true, color: { argb: 'FF808080' } };
  sum.getCell('A3').value = 'จำนวนคน'; sum.getCell('B3').value = req.people ?? 2; sum.getCell('C3').value = req.people ? '← แก้ได้ ทุกชีตคำนวณใหม่เอง' : '← ไม่ได้บอกจำนวนคน ใส่ไว้ 2 คน แก้ได้';
  sum.getCell('A4').value = 'งบที่ตั้งไว้ (บาท)'; sum.getCell('B4').value = req.budget ? (req.perPerson ? { formula: `${req.budget}*B3` } : req.budget) : null; sum.getCell('B4').numFmt = MONEY;
  if (req.perPerson) sum.getCell('C4').value = `← คนละ ${req.budget.toLocaleString('en-US')} บาท`;
  for (const a of ['B3', 'B4']) { sum.getCell(a).fill = fill('FFFFF2CC'); sum.getCell(a).border = box; sum.getCell(a).font = { ...FONT, bold: true, size: 12 }; }
  for (const a of ['A3', 'A4']) sum.getCell(a).font = { ...FONT, bold: true };
  for (const a of ['C3', 'C4']) sum.getCell(a).font = { ...FONT, italic: true, color: { argb: 'FF808080' } };
  const top = 6;
  head(sum, top, ['วัน', '', 'รวมทุกคน (บาท)', 'ต่อคน (บาท)', 'ไฮไลต์ของวัน']);
  days.forEach(({ name, tot, day }, k) => {
    const row = sum.getRow(top + 1 + k);
    row.getCell(1).value = { text: name, hyperlink: `#'${name}'!A1` }; row.getCell(1).font = { ...FONT, color: { argb: 'FF1F4E99' }, underline: true };
    row.getCell(3).value = { formula: `'${name}'!H${tot}` }; row.getCell(4).value = { formula: `'${name}'!G${tot}` };
    row.getCell(5).value = day.theme || day.items.filter((i) => i.cites.length).map((i) => i.text.replace(/\s*(?:ค่า\S*\s*)?\d[\d,]*.*$/u, '')).slice(0, 3).join(' · ');
    for (let c = 1; c <= 5; c++) { row.getCell(c).border = box; if (c > 1) row.getCell(c).font = FONT; }
    for (const c of [3, 4]) row.getCell(c).numFmt = MONEY;
  });
  const gr = top + 1 + days.length, g = sum.getRow(gr);
  g.getCell(1).value = 'รวมทั้งทริป'; g.getCell(3).value = { formula: `SUM(C${top + 1}:C${gr - 1})` }; g.getCell(4).value = { formula: `SUM(D${top + 1}:D${gr - 1})` };
  for (let c = 1; c <= 5; c++) { g.getCell(c).fill = fill('FFDDEBF7'); g.getCell(c).border = box; g.getCell(c).font = { ...FONT, bold: true, size: 12 }; }
  for (const c of [3, 4]) g.getCell(c).numFmt = MONEY;
  const left = sum.getRow(gr + 1);
  left.getCell(1).value = 'งบเหลือ (งบ − รวมทั้งทริป)'; left.getCell(3).value = { formula: `IF(B4="","",B4-C${gr})` }; left.getCell(3).numFmt = MONEY; left.getCell(1).font = { ...FONT, bold: true };
  const ct = gr + 3;
  head(sum, ct, ['แยกตามประเภท', '', 'รวมทุกคน (บาท)', 'ต่อคน (บาท)']);
  TRIP_CATS.forEach((cat, k) => {
    const row = sum.getRow(ct + 1 + k);
    row.getCell(1).value = cat;
    row.getCell(3).value = { formula: days.map(({ name }) => `SUMIF('${name}'!D:D,A${ct + 1 + k},'${name}'!H:H)`).join('+') || '0' };
    row.getCell(4).value = { formula: `IF($B$3>0,C${ct + 1 + k}/$B$3,"")` };
    for (let c = 1; c <= 4; c++) { row.getCell(c).border = box; row.getCell(c).font = FONT; }
    for (const c of [3, 4]) row.getCell(c).numFmt = MONEY;
  });
  const nr = ct + TRIP_CATS.length + 2;
  ['หมายเหตุ', '• ช่องสีเหลืองแก้ได้ ทุกชีตคำนวณใหม่เอง', '• ยอดรวมนับเฉพาะรายการที่แหล่งบอกราคา ค่ารถไป-กลับ ที่พัก และอาหารที่แหล่งไม่ได้บอกราคา ยังไม่รวม',
    '• คิดราคา: ต่อคน = คูณจำนวนคน · ทั้งกลุ่ม (เช่น ห้องพัก เหมารถ) = หารจำนวนคน · ราคาช่วง เช่น 800-1,200 บาท ใช้ราคาต่ำสุด']
    .forEach((t, k) => { const c = sum.getCell(nr + k, 1); c.value = t; c.font = { ...FONT, bold: k === 0, color: { argb: k ? 'FF404040' : 'FF000000' } }; });
  // ---- prices the sources give, and the sources ----
  if (r.plan.budget.length) {
    const pr = wb.addWorksheet('ราคาจากแหล่ง');
    pr.columns = [{ width: 60 }, { width: 14 }, { width: 10 }];
    head(pr, 1, ['รายการ (ตามที่แหล่งเขียน)', 'ราคา (บาท)', 'แหล่ง']);
    r.plan.budget.forEach((i, k) => { const p = priceOf(i.text), row = pr.getRow(k + 2); row.values = [i.text, p?.price ?? null, i.cites.map((c) => `[${c}]`).join('')]; row.getCell(2).numFmt = MONEY; for (let c = 1; c <= 3; c++) { row.getCell(c).border = box; row.getCell(c).font = FONT; row.getCell(c).alignment = { wrapText: true, vertical: 'top' }; } });
  }
  const src = wb.addWorksheet('แหล่งข้อมูล');
  src.columns = [{ width: 6 }, { width: 50 }, { width: 70 }];
  head(src, 1, ['#', 'ชื่อ', 'ลิงก์']);
  r.sources.forEach((s, k) => { const row = src.getRow(k + 2); row.values = [`[${k + 1}]`, s.title, { text: s.url, hyperlink: s.url }]; row.getCell(3).font = { ...FONT, color: { argb: 'FF1F4E99' }, underline: true }; row.getCell(1).font = FONT; row.getCell(2).font = FONT; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

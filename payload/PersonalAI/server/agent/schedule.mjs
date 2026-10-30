// Agent jobs on a schedule (user, 2026-10-25: "ทำให้ lumicos เป็น Agent ในส่วนอื่นต่อได้เลย"):
// "ทุกเช้า 7 โมง สรุปข่าว AI ให้หน่อย", "ทุกวันจันทร์ ค้นเรื่อง X แล้วเก็บเข้าคลัง", "พรุ่งนี้ 9 โมง อัปเดตเรื่อง X ในคลัง".
// Pure functions: reading a schedule out of a message, when a rule fires, and Thai labels. Thai time (UTC+7, no DST).

const TZ = 7 * 3_600_000;
const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
/** Bangkok wall clock of an instant (read it with getUTC*). */
const wall = (ms) => new Date(ms + TZ);
/** The instant of a Bangkok wall-clock time. */
const instant = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo, d, h, mi) - TZ;
/** Midnight (Bangkok) of the day an instant falls on. */
export const dayStart = (ms) => { const w = wall(ms); return instant(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()); };

const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const DAY_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const DAY_WORD = String.raw`(?:จันทร์|อังคาร|พุธ|พฤหัส(?:บดี)?|ศุกร์|เสาร์|อาทิตย์)`;
const dayIndex = (w) => (w.startsWith('พฤหัส') ? 4 : DAYS.indexOf(w));
const NUM_WORDS = { 'สิบเอ็ด': 11, 'สิบสอง': 12, 'หนึ่ง': 1, 'สอง': 2, 'สาม': 3, 'สี่': 4, 'ห้า': 5, 'หก': 6, 'เจ็ด': 7, 'แปด': 8, 'เก้า': 9, 'สิบ': 10 };
const NUM_WORD = 'สิบเอ็ด|สิบสอง|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ';
const arabic = (s) => String(s ?? '').replace(/[๐-๙]/gu, (c) => String(c.charCodeAt(0) - 0x0e50));
const pad = (n) => String(n).padStart(2, '0');

/** Number words next to a time word become digits: "เจ็ดโมงเช้า" → "7โมงเช้า", "บ่ายสอง" → "บ่าย2", "ตีห้า" → "ตี5". */
function timeDigits(text) {
  return text.replace(new RegExp(`(${NUM_WORD})(?=\\s*(?:โมง|ทุ่ม|นาฬิกา))`, 'gu'), (w) => String(NUM_WORDS[w]))
    .replace(new RegExp(`(ตี|บ่าย)\\s*(${NUM_WORD})`, 'gu'), (_, p, w) => `${p}${NUM_WORDS[w]}`);
}

const MIN_PART = String.raw`(?:\s*(ครึ่ง|\d{1,2}\s*นาที))?`;
const minutes = (s) => (!s ? 0 : s === 'ครึ่ง' ? 30 : parseInt(s, 10));
/**
 * The time of day a message names, with where it was found: {hour, minute, bare, index, length} or null.
 * Same reading as the world-time skill: "4 โมง" = 16:00, "สี่โมงเช้า" = 10:00, "บ่าย 2" = 14:00, "2 ทุ่ม" = 20:00, "ตี 5" = 05:00.
 * "bare" marks "N โมง" without เช้า/เย็น, which a part of the day ("ทุกเย็น") may move by 12 hours.
 */
export function findTime(text) {
  const t = text;
  const found = [];
  const add = (m, hour, minute, bare = false) => { if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) found.push({ hour, minute, bare, index: m.index, length: m[0].length }); };
  for (const m of t.matchAll(/(?<![\d.:])([01]?\d|2[0-3]):([0-5]\d)(?!\d)\s*(?:น\.?|นาฬิกา)?/gu)) add(m, +m[1], +m[2]);
  // "7.30" only as a time ("7.30 น.", "เวลา 7.30"): a version or price like "10.10" is not
  for (const m of t.matchAll(/(?:(?:เวลา|ตอน)\s*)([01]?\d|2[0-3])\.([0-5]\d)(?!\d)\s*(?:น\.?|นาฬิกา)?|(?<![\d.])([01]?\d|2[0-3])\.([0-5]\d)\s*(?:น\.|นาฬิกา)/gu)) add(m, +(m[1] ?? m[3]), +(m[2] ?? m[4]));
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)/giu)) { const h = +m[1] % 12; add(m, /^p/i.test(m[2]) ? h + 12 : h, 0); }
  for (const m of t.matchAll(new RegExp(`เที่ยง\\s*คืน${MIN_PART}`, 'gu'))) add(m, 0, minutes(m[1]));
  for (const m of t.matchAll(new RegExp(`เที่ยง(?!\\s*คืน|ตรง|ธรรม|แท้)(?:\\s*วัน)?${MIN_PART}`, 'gu'))) add(m, 12, minutes(m[1]));
  for (const m of t.matchAll(new RegExp(`ตี\\s*(\\d{1,2})${MIN_PART}`, 'gu'))) add(m, +m[1] % 24, minutes(m[2]));
  for (const m of t.matchAll(new RegExp(`(?<![\\d.])(\\d{1,2})\\s*ทุ่ม(?!เท)${MIN_PART}`, 'gu'))) add(m, 18 + +m[1], minutes(m[2]));
  for (const m of t.matchAll(new RegExp(`บ่าย\\s*(\\d{1,2})?\\s*(?:โมง)?${MIN_PART}`, 'gu'))) if (m[1] || /โมง/u.test(m[0])) add(m, 12 + +(m[1] ?? 1), minutes(m[2]));
  for (const m of t.matchAll(new RegExp(`(?<![\\d.])(\\d{1,2})\\s*โมง\\s*(เช้า|เย็น)?${MIN_PART}`, 'gu'))) {
    const n = +m[1];
    if (m[2] === 'เย็น') add(m, n < 12 ? n + 12 : n, minutes(m[3]));
    else if (m[2] === 'เช้า') add(m, n <= 5 ? n + 6 : n, minutes(m[3]));
    else add(m, n >= 1 && n <= 5 ? n + 12 : n % 24, minutes(m[3]), true);
  }
  for (const m of t.matchAll(new RegExp(`(?<![\\d.])(\\d{1,2})\\s*นาฬิกา(?:\\s*(\\d{1,2})\\s*นาที)?`, 'gu'))) add(m, +m[1], minutes(m[2]));
  if (!found.length) return null;
  // the earliest, longest match ("บ่าย 2 โมงครึ่ง" over "2 โมงครึ่ง")
  return found.sort((a, b) => a.index - b.index || b.length - a.length)[0];
}

/** Part of the day a message names ("ทุกเย็น", "ตอนเช้า", "คืนนี้"), for a default time and to place a bare "N โมง".
 *  Only as a time phrase: "คืนเงิน", "สรุปข่าวเช้า" or "เที่ยงตรง" in the job are not a time. */
function partOfDay(text) {
  if (/(?:ทุก|ตอน|ช่วง|พรุ่งนี้|มะรืน(?:นี้)?|วัน\S{0,8}?)\s*เช้า|เช้า\s*นี้|โมง\s*เช้า/u.test(text)) return 'morning';
  if (/(?:ทุก|ตอน|ช่วง)\s*เที่ยง(?!\s*คืน|ตรง|ธรรม|แท้)/u.test(text)) return 'noon';
  if (/(?:ทุก|ตอน|ช่วง|พรุ่งนี้|มะรืน(?:นี้)?)\s*บ่าย|บ่าย\s*นี้/u.test(text)) return 'afternoon';
  if (/(?:ทุก|ตอน|ช่วง|พรุ่งนี้|มะรืน(?:นี้)?|วัน\S{0,8}?)\s*เย็น|เย็น\s*นี้|โมง\s*เย็น/u.test(text)) return 'evening';
  if (/(?:ทุก|ตอน|ช่วง|พรุ่งนี้|มะรืน(?:นี้)?)\s*(?:กลาง\s*)?(?:คืน|ค่ำ)|(?:คืน|ค่ำ)\s*นี้|กลาง\s*คืน/u.test(text)) return 'night';
  return null;
}
const PART_DEFAULT = { morning: [7, 0], noon: [12, 0], afternoon: [13, 0], evening: [18, 0], night: [21, 0] };

/**
 * When a schedule fires, read from a message: {rule, matched: [[index, length], …], timeGuessed} or null.
 * Rules: {type: 'daily', hour, minute} · {type: 'weekly', days: [0–6], hour, minute} · {type: 'once', at}.
 */
export function parseWhen(input, now = Date.now()) {
  const text = timeDigits(arabic(input).replace(/\s+/gu, ' '));
  const spans = [];
  let rule = null;
  const take = (m) => { spans.push([m.index, m[0].length]); return m; };
  let m;
  // recurring: weekdays, weekends, a list of days, every day, every week
  if ((m = text.match(/ทุก\s*วัน\s*(?:ธรรมดา|ทำงาน)|(?:ทุก\s*)?(?:วัน\s*)?จันทร์\s*(?:ถึง|-|–)\s*(?:วัน\s*)?ศุกร์|ทุก\s*(?:วัน\s*)?(?:จ\.?\s*-\s*ศ\.?)/u))) { take(m); rule = { type: 'weekly', days: [1, 2, 3, 4, 5] }; }
  else if ((m = text.match(/ทุก\s*(?:วัน\s*)?(?:หยุด|สุดสัปดาห์|เสาร์\s*(?:-|–|และ|กับ|,)?\s*(?:วัน\s*)?อาทิตย์)/u))) { take(m); rule = { type: 'weekly', days: [6, 0] }; }
  else if ((m = text.match(new RegExp(`ทุก\\s*(?:วัน\\s*)?(${DAY_WORD}(?:\\s*(?:,|และ|กับ|หรือ)?\\s*(?:วัน\\s*)?${DAY_WORD})*)`, 'u')))
    && !/^ทุก\s*อาทิตย์$/u.test(m[0].trim())) {
    take(m); rule = { type: 'weekly', days: [...new Set([...m[1].matchAll(new RegExp(DAY_WORD, 'gu'))].map((x) => dayIndex(x[0])))].sort() };
  } else if ((m = text.match(/ทุก\s*(?:สัปดาห์|อาทิตย์)/u))) { take(m); rule = { type: 'weekly', days: [1], weekDefault: true }; }
  // "ทุกวันนี้" means nowadays, not every day
  else if ((m = text.match(/ทุก\s*(?:วัน(?!\s*นี้)|เช้า|เย็น|คืน|ค่ำ|เที่ยง(?!\s*คืน)|บ่าย)|ทุก\s*(?=\d{1,2}\s*(?:โมง|ทุ่ม|นาฬิกา|น\.|[:.]\d{2})|ตี\s*\d)|\bevery\s*day\b|\bdaily\b/iu))) { take(m); rule = { type: 'daily' }; } // "ทุก 9 โมงเช้า", "ทุก 08.30 น." = every day at that time
  // once: in N minutes/hours, today/tonight/tomorrow/the day after, this/next <day>
  else if ((m = text.match(/อีก\s*(\d{1,3})\s*(นาที|ชั่วโมง|ชม\.?)/u))) {
    take(m);
    const n = +m[1], ms = m[2] === 'นาที' ? n * MINUTE : n * HOUR;
    if (n < 1 || ms > 7 * DAY) return null;
    return { rule: { type: 'once', at: Math.ceil((now + ms) / MINUTE) * MINUTE }, spans, timeGuessed: false };
  } else if ((m = text.match(new RegExp(`(?:วัน\\s*)?(${DAY_WORD})\\s*(หน้า|นี้)`, 'u'))) || (m = text.match(/(พรุ่งนี้|มะรืน(?:นี้)?|วันนี้|คืนนี้|เย็นนี้|เช้านี้|บ่ายนี้|ค่ำนี้)/u))) {
    take(m);
    const today = dayStart(now);
    let day;
    if (m[2]) { // "วันจันทร์หน้า" = the coming Monday, at least tomorrow; "วันจันทร์นี้" = this week's (today allowed)
      const want = dayIndex(m[1]), wd = wall(now).getUTCDay();
      let ahead = (want - wd + 7) % 7;
      if (m[2] === 'หน้า' && ahead === 0) ahead = 7;
      day = today + ahead * DAY;
    } else day = today + ({ 'พรุ่งนี้': 1, 'มะรืน': 2, 'มะรืนนี้': 2 }[m[1]] ?? 0) * DAY;
    rule = { type: 'once', day };
  }
  if (!rule) return null;
  const time = findTime(text);
  let hour, minute, timeGuessed = false;
  const part = partOfDay(text);
  // "สรุปข่าว AI วันนี้ให้หน่อย" is a question about today, not a job for later: a day word needs a time or a part of the day
  if (rule.type === 'once' && !time && !part) return null;
  if (time) {
    ({ hour, minute } = time);
    if (time.bare && part === 'morning' && hour >= 12) hour -= 12;
    if (time.bare && ['afternoon', 'evening', 'night'].includes(part) && hour < 12) hour += 12;
    spans.push([time.index, time.length]);
  } else if (part) [hour, minute] = PART_DEFAULT[part];
  else { [hour, minute] = [7, 0]; timeGuessed = true; }
  if (rule.type === 'once') {
    const at = rule.day + hour * HOUR + minute * MINUTE;
    return { rule: { type: 'once', at }, spans, timeGuessed };
  }
  return { rule: { ...rule, hour, minute }, spans, timeGuessed };
}

/** The message with the schedule words (and leftover joiners) taken out: what is left is the job. */
export function withoutWhen(input, spans) {
  let text = timeDigits(arabic(input).replace(/\s+/gu, ' '));
  for (const [index, length] of [...spans].sort((a, b) => b[0] - a[0])) text = `${text.slice(0, index)} ${text.slice(index + length)}`;
  return text.replace(/(?:^|\s)(?:เวลา|ตอน|ช่วย|ให้)(?=\s|$)/gu, ' ').replace(/^\s*(?:เช้า|เย็น|ค่ำ|คืน|ละ|ล่ะ)(?=\s|$)/u, ' ').replace(/\s+/gu, ' ').trim();
}

/** The time a rule fires next, strictly after `after`. */
export function nextRun(rule, after = Date.now()) {
  if (rule.type === 'once') return rule.at > after ? rule.at : null;
  for (let d = dayStart(after), i = 0; i < 9; i++, d += DAY) {
    const at = d + rule.hour * HOUR + rule.minute * MINUTE;
    if (at <= after) continue;
    if (rule.type === 'weekly' && !rule.days.includes(wall(at).getUTCDay())) continue;
    return at;
  }
  return null;
}

/** The latest time a rule fired at or before `now` (looking back up to 8 days), or null. */
export function lastDue(rule, now = Date.now()) {
  if (rule.type === 'once') return rule.at <= now ? rule.at : null;
  for (let d = dayStart(now), i = 0; i < 9; i++, d -= DAY) {
    const at = d + rule.hour * HOUR + rule.minute * MINUTE;
    if (at > now) continue;
    if (rule.type === 'weekly' && !rule.days.includes(wall(at).getUTCDay())) continue;
    return at;
  }
  return null;
}

/** "ทุกวัน 07:00", "ทุกวันจันทร์ 09:00", "วันธรรมดา 08:30", "ครั้งเดียว อ. 28 ต.ค. 09:00". */
export function describeRule(rule) {
  const hm = (h, m) => `${pad(h)}:${pad(m)}`;
  if (rule.type === 'once') { const w = wall(rule.at); return `ครั้งเดียว ${DAY_SHORT[w.getUTCDay()]} ${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]} ${hm(w.getUTCHours(), w.getUTCMinutes())}`; }
  const time = hm(rule.hour, rule.minute);
  if (rule.type === 'daily') return `ทุกวัน ${time}`;
  const days = [...rule.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (days.join() === '1,2,3,4,5') return `วันธรรมดา (จันทร์–ศุกร์) ${time}`;
  if (days.join() === '6,0') return `ทุกเสาร์–อาทิตย์ ${time}`;
  return `ทุกวัน${days.map((d) => DAYS[d]).join('/')} ${time}`;
}

/** "วันนี้ 18:00", "พรุ่งนี้ 07:00", "จ. 27 ต.ค. 09:00". */
export function formatWhen(at, now = Date.now()) {
  const w = wall(at), days = Math.round((dayStart(at) - dayStart(now)) / DAY);
  const hm = `${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
  if (days === 0) return `วันนี้ ${hm}`;
  if (days === 1) return `พรุ่งนี้ ${hm}`;
  return `${DAY_SHORT[w.getUTCDay()]} ${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]} ${hm}`;
}

/** Same Bangkok calendar day? (a missed daily or weekly run is still made later the same day) */
export const sameDay = (a, b) => dayStart(a) === dayStart(b);

// ---- managing schedules from the chat ------------------------------------------------------------------------
const JOBS = String.raw`งาน\s*(?:ที่\s*)?ตั้ง\s*เวลา(?:\s*ไว้)?`;
/** "ดูงานที่ตั้งเวลาไว้", "มีงานตั้งเวลาอะไรบ้าง", "ตั้งเวลาอะไรไว้บ้าง" */
export const LIST_ASK = new RegExp(`^(?:ช่วย\\s*)?(?:ขอ\\s*)?(?:ดู|เช็[กค]|แสดง|เปิด)?\\s*(?:รายการ\\s*)?(?:มี\\s*)?${JOBS}\\s*(?:มี\\s*)?(?:อะไร\\s*)?(?:บ้าง|ทั้งหมด|หน่อย|ไหม|มั้ย|อยู่)?\\s*(?:บ้าง|ไหม|มั้ย|หน่อย|ครับ|ค่ะ|คะ|นะ)?\\s*[?？]?$|^ตั้ง\\s*เวลา\\s*(?:อะไร\\s*)?ไว้\\s*(?:อะไร\\s*)?บ้าง|^(?:show|list)\\s+(?:my\\s+)?scheduled\\s+(?:jobs|tasks)`, 'iu');
/** "ยกเลิกงานตั้งเวลาข้อ 2", "ลบงานตั้งเวลาทั้งหมด", "ยกเลิกงานตั้งเวลาสรุปข่าว AI" → the target text ('' when not said) */
const CANCEL_ASK = new RegExp(`^(?:ช่วย\\s*)?(?:ยกเลิก|ลบ|หยุด|เลิก|ปิด)\\s*${JOBS}\\s*(.*)$`, 'u');
/** "ทำงานตั้งเวลาข้อ 1 ตอนนี้เลย", "รันงานตั้งเวลาสรุปข่าว AI เดี๋ยวนี้" → the target text */
const RUN_ASK = new RegExp(`^(?:ช่วย\\s*)?(?:ลอง\\s*)?(?:ทำ|รัน|เริ่ม|สั่ง)\\s*${JOBS}\\s*(.*?)\\s*(?:(?:ตอนนี้|เดี๋ยวนี้|เลย|ทันที|ให้ดู|ดู)\\s*)+(?:หน่อย|นะ|ที)?\\s*$`, 'u');
const tidyTarget = (s) => String(s ?? '').replace(/(?:\s*(?:ให้\s*)?(?:หน่อย|ด้วย|นะ|ที|ครับ|ค่ะ|คะ))+\s*$/u, '').replace(/^(?:ที่|เรื่อง|อัน)\s*/u, '').trim();
export function scheduleCommand(text) {
  const t = arabic(text).replace(/\s+/gu, ' ').trim();
  if (LIST_ASK.test(t)) return { kind: 'schedule-list' };
  let m = t.match(RUN_ASK);
  if (m) return { kind: 'schedule-run', target: tidyTarget(m[1]) };
  m = t.match(CANCEL_ASK);
  if (m) return { kind: 'schedule-cancel', target: tidyTarget(m[1]) };
  return null;
}

/** Which schedules a target names: "ทั้งหมด" → all, "ข้อ 2" / "2" → the second in the list, else by topic words. */
export function pickSchedules(list, target) {
  const t = String(target ?? '').trim();
  if (!t) return list.length === 1 ? list : [];
  if (/^(?:ทั้งหมด|ทุกงาน|ทุกอัน|all)$/iu.test(t)) return list;
  const n = t.match(/^(?:ข้อ|อันที่|งานที่|ลำดับที่|ที่|#|no\.?)?\s*(\d{1,2})$/iu);
  if (n) return list[+n[1] - 1] ? [list[+n[1] - 1]] : [];
  const k = t.toLowerCase().replace(/^(?:สรุปข่าว|สรุป|ค้นคว้า|ค้น|อัปเดต|ข่าว)\s*/u, '').trim();
  return list.filter((s) => { const topic = String(s.topic).toLowerCase(); return k && (topic.includes(k) || k.includes(topic) || String(s.label ?? '').toLowerCase().includes(k)); });
}

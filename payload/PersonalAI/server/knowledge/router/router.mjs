import { resolveFollowUp, joinFollowUp } from './followUp.mjs';
import { normalizeRoute } from './routes.mjs';

const LOCAL = /(เอกสาร|ไฟล์|pdf|docx|xlsx|markdown|โน้ต|ฐานความรู้|คลังความรู้|ฐานข้อมูล|\bRAG\b|knowledge base|ในเครื่อง|local document|uploaded|attachment|ตามคู่มือ)/iu;
// Topics that are about the outside world right now.
const WEB_TOPIC = /(เนื้อเพลง|lyrics|รีวิว|ข่าว|ราคา|อากาศ|ตารางแข่ง|ผลบอล|ผลการแข่ง|อัปเดต|อัตราแลกเปลี่ยน|ค่าเงิน|หุ้น|เพลงใหม่|ผลงานใหม่|อัลบั้มใหม่|หนังใหม่|news|price|weather|schedule|exchange rate|stock|new (?:song|album|release|movie)|ทอง(?:คำ)?(?:แท่ง|รูปพรรณ)?\s*(?:วันนี้|ตอนนี้|ล่าสุด|ขึ้น|ลง)|แข่ง(?:กับ)?ใคร|แข่งกี่โมง|เตะกี่โมง|ถ่ายทอดสด|นัดต่อไป|ตารางบอล|โปรแกรม(?:บอล|ฟุตบอล|การแข่ง)|หนังเข้า|รอบฉาย|โรงหนัง|คอนเสิร์ต|อีเวนต์|อีเว้นท์|pm\s?2\.?5|ฝุ่น\s?(?:pm|ละออง)|คุณภาพอากาศ|\baqi\b|ค่าไฟ|ค่า\s?ft\b|สลาก|ล็อตเตอรี่|ลอตเตอรี่|หวย|เปิดใหม่|ร้านใหม่|เวลาเปิด|เวลาปิด|เปิดกี่โมง|ปิดกี่โมง|เวลาทำการ|วันหยุดยาว)/iu;
// Time words alone ("วันนี้เหนื่อยจัง") are small talk; they need a real question to mean "look it up".
const WEB_TIME = /(ล่าสุด|วันนี้|ตอนนี้|ปัจจุบัน|current|latest|today|recent)/iu;
const QUESTION = /(ใคร|อะไร|อันไหน|ไหน|เท่าไ[รห]|กี่|เมื่อไ[รห]|ยังไง|อย่างไร|หรือยัง|หรือเปล่า|ไหม|มั้ย|มั๊ย|\?|who|what|which|when|where|how much|how many|is there|are there)/iu;
const SMALL_TALK = /(เหนื่อย|เบื่อ|ง่วง|หิว|เหงา|คิดถึง|สบายดี|เป็นไง|เป็นยังไง|ทำอะไรอยู่|กินอะไรดี|รู้สึก|อารมณ์|how are you|how's your|how was your|i feel|i'm tired|จัง(?:เลย)?\s*[!~.]*\s*$|มาก(?:\s?ๆ)?(?:เลย)?\s*[!~.]*\s*$|(?:เธอ|คุณ|นาย|โนวา|lumicos|nova|โนวา)\s*(?:กำลัง)?\s*(?:ทำอะไร|อยู่ไหน|อยู่ที่ไหน|ชอบ|กินอะไร|นอน))/iu;
// A statement with a topic word ("ราคา 1,250 บาท…") is only a lookup when it is a short request or uses a lookup verb.
const LOOKUP_VERB = /((?:^|\s|ช่วย|ลอง|ไป)(?:ขอ(?!ง|บ)|หา(?!ก)|เช็ก|เช็ค|ตรวจ|บอก|สรุป|อ่าน|อัปเดต))|tell me|show me|check|find|look up|get me/iu;
const USER_FIGURES = /\d[\d,.]*\s*(?:บาท|฿|\$|ดอลลาร์|%|เปอร์เซ็นต์|วัตต์|kwh\b|kw\b|w\b|btu\b|บีทียู|หน่วย|โมง|นาฬิกา|น\.|ต\.ค\.|ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|พ\.ย\.|ธ\.ค\.)|\d{1,2}:\d{2}/iu;
const WEB = { test: (q) => (WEB_TOPIC.test(q) && (QUESTION.test(q) || /เป็นไง|เป็นยังไง|how is|how's/iu.test(q)
    || (!SMALL_TALK.test(q) && !USER_FIGURES.test(q) && (q.length <= 40 || LOOKUP_VERB.test(q)))))
  || (WEB_TIME.test(q) && QUESTION.test(q) && !SMALL_TALK.test(q)) };
// Keep identical to EXPLICIT_WEB_REQUEST (chat/integration.mjs) and explicitWebRequest (src/chat/runChatReply.ts).
const EXPLICIT_WEB = /((?:ค้น|หา|เช็ก|เช็ค|ดู|เสิร์ช)\S{0,8}?(?:ใน|จาก|บน|ทาง)?\s*(?:เว็บ|เน็ต(?!ฟลิกซ์|ฟลิก)|อินเทอร์เน็ต|อินเตอร์เน็ต|ออนไลน์|กูเกิล|google)|เว็บ\s*เสิร์ช|เสิร์ช(?:เว็บ|หา|ดู|ให้)|ใช้\s*(?:web_search|เว็บ)|web\s*search|search\s+(?:the\s+)?(?:web|internet|online)|look\s+(?:it\s+)?up\s+online|google\s+it|browse\s+(?:the\s+)?web)/iu;
// "ดูในคลัง", "ค้นใน RAG", "จากฐานความรู้", "search my notes": the user names the library as the place to look.
export const EXPLICIT_LOCAL = /((?:ค้น|หา|เช็ก|เช็ค|ดู|เปิด|อ่าน|ตรวจ)\S{0,8}?\s*(?:ใน|จาก|ที่)\s*(?:คลัง(?:ความรู้|เอกสาร)?|ฐานความรู้|RAG\b|knowledge\s*base|โน้ตของ(?:ฉัน|เรา)|เอกสารที่(?:อัป?โหลด|เก็บ|แนบ)ไว้)|ใช้\s*(?:RAG\b|คลังความรู้|ฐานความรู้)|(?:search|check|look(?:\s+in)?|find)\s+(?:in\s+)?(?:my\s+|the\s+)?(?:knowledge\s*base|library|notes|documents)|(?:in|from)\s+(?:my\s+)?(?:knowledge\s*base|library)|(?:^|\s|แล้ว)(?:ใน|จาก|ตาม)\s*(?:คลัง(?:ความรู้|เอกสาร)|ฐานความรู้)|คลัง(?:ความรู้|เอกสาร)(?:\s*ของ(?:เรา|ฉัน|ผม))?\s*(?:เขียน|บอก|ว่า|มี|ระบุ|พูด))/iu;
const NO_WEB = /(ห้ามค้น(?:หา)?เว็บ|ไม่ต้องค้น(?:หา)?เว็บ|อย่าค้น(?:หา)?เว็บ|ไม่ใช้อินเทอร์เน็ต|do not (?:search|browse)|don'?t (?:search|browse)|without web|no web)/iu;
const MEMORY = /(จำได้ไหม|ฉันชอบ|ของฉัน|เกี่ยวกับฉัน|เราเคย|ที่ฉันบอก|my preference|remember (?:me|my)|what did i tell|about me)/iu;
const DIRECT = /(^\s*(?:สวัสดี|หวัดดี|ขอบคุณ|โอเค)(?:\s|$))|(^\s*(?:hello|hi|thanks|thank you)\b)|(^\s*[\d\s+*/().%-]+[=?]?\s*$)/iu;
// A message that is only thanks ("ขอบใจนะ", "ขอบคุณมากค่ะ 🙏") has nothing to look up (claude-20261024: "ขอบใจนะ" went
// to a library search and Lumicos answered "รับทราบค่ะ").
const THANKS_ONLY = /^\s*(?:(?:โอเค|ok|okay)\s*)?(?:ขอบคุณ|ขอบใจ|thx|thanks|thank\s*you)(?:\s*(?:มาก|ๆ|นะ|น้า|คะ|ค่ะ|ครับ|จ้า|จ้ะ|ฮะ|เลย|จริง|so much|a lot|very much))*\s*[!.~^]*[\s\p{Extended_Pictographic}\u{FE0F}\u{200D}]*$/iu;
// The user supplied the text and wants it read aloud / said / translated / spelled: never search.
const TEXT_TASK = /((?:อ่าน|ออกเสียง|พูด|แปล|สะกด|ทวน)(?:ให้ฟัง)?\s*(?:คำ|ประโยค|ข้อความ|ตัวเลข|ตาม|ต่อไป)\s*(?:นี้|ข้างบน|ข้างต้น))|((?:อ่าน|พูด|ออกเสียง)(?:ตาม)?ว่า)|(read (?:this|it|the following)(?: (?:aloud|out(?: loud)?))?|say (?:this|the following)|translate (?:this|the following))/iu;
const ROLEPLAY = /(roleplay|บทบาทสมมติ|สวมบทบาท|แสดงเป็น|pretend to be)/iu;
// "100 ไมล์ กี่กิโลเมตร", "30 องศาเซลเซียส เป็นฟาเรนไฮต์": a unit conversion never changes, so it never needs the web,
// even right after a turn about prices (the follow-up join would otherwise add "ราคา" and send it to the web).
// Money, prices and "today" are excluded: "1 ดอลลาร์ กี่บาท" or "น้ำมัน 1 ลิตร ราคาเท่าไหร่" need live data.
const UNIT = '(?:ไมล์|กิโลเมตร|กิโลกรัม|กิโล|กม\\.?|เมตร|เซนติเมตร|เซนต์|ซม\\.?|มิลลิเมตร|มม\\.?|นิ้ว|ฟุต|หลา|ปอนด์|ออนซ์|กรัม|ตัน|ลิตร|มิลลิลิตร|มล\\.?|แกลลอน|องศา|เซลเซียส|ฟาเรนไฮต์|ไร่|ตารางวา|ตารางเมตร|ตร\\.ม\\.|miles?|km|kilomet(?:er|re)s?|kg|kilograms?|lbs?|pounds?|oz|ounces?|inch(?:es)?|feet|foot|ft|yards?|gallons?|lit(?:er|re)s?|celsius|fahrenheit|°\\s*[CF])';
const CONVERSION = new RegExp(`\\d[\\d,.]*\\s*${UNIT}.*?(?:กี่|เท่าไ[รห]|เป็น|แปลง|=|\\bin\\b|\\bto\\b|how many)|(?:แปลง|convert)\\s*\\d[\\d,.]*\\s*${UNIT}`, 'iu');
// "1 ดอลลาร์ กี่บาท", "แลก 500 ยูโร ได้กี่บาท", "100 บาท เป็นเยนเท่าไหร่": exchange rates change every day, so they need the web.
const FX_CURRENCY = '(?:ดอลลาร์|ดอลล่าร์|เยน|ยูโร|หยวน|วอน|ปอนด์|ริงกิต|รูปี|ฟรังก์|\\b(?:usd|eur|jpy|cny|rmb|krw|gbp|sgd|myr|hkd|twd|aud|dollars?|yen|euros?|yuan|won)\\b)';
const FX = new RegExp(`${FX_CURRENCY}.{0,30}(?:บาท|เงินไทย|\\bthb\\b|\\bbaht\\b)|(?:บาท|เงินไทย|\\bthb\\b|\\bbaht\\b).{0,30}${FX_CURRENCY}`, 'iu');
// "ราคา 1,250 บาท ลด 15% เหลือเท่าไหร่", "2,500 บาท แพงไปไหม": the user gave the numbers; work with them instead of searching.
const FIGURE_TASK = /(ลด|เหลือ|รวม|ทั้งหมด|คูณ|หาร|บวก|ลบ|ทอน|ส่วนลด|%|เปอร์เซ็นต์|คนละ|ต่อคน|ต่อชิ้น|ต่อเดือน|ต่อวัน|ต่อปี|เดือนละ|วันละ|ปีละ|หน่วยละ|กินไฟ|ค่าไฟ|แพงไป|ถูกไป|แพงไหม|แพงมั้ย|คุ้มไหม|คุ้มมั้ย|คุ้มค่าไหม)/iu;
// "ช่วยเขียนรีวิวร้านกาแฟ", "แต่งกลอนเรื่องอากาศหนาว": writing about a topic is not a lookup (unless it says today/latest or asks to search).
const WRITE_TASK = /(?:^|\s|ช่วย|ลอง)(?:เขียน|แต่ง|ร่าง|ตั้งชื่อ|เรียบเรียง)/u;
// "ตอนนี้ที่ญี่ปุ่นกี่โมง", "3 ทุ่มไทย ลอนดอนกี่โมง": the computer's clock answers these (skill world-time), not the web.
const CLOCK = /(กี่โมง|ต่างกันกี่ชั่วโมง|เวลา(?:ที่|ใน|ของ)?\s*(?:ญี่ปุ่น|เกาหลี|จีน|อังกฤษ|อเมริกา|ยุโรป|ออสเตรเลีย)|what time is it|time zone|timezone)/iu;
const CLOCK_PLACE = /(ตอนนี้|ไทย|กรุงเทพ|ญี่ปุ่น|โตเกียว|โอซาก้า|เกาหลี|โซล|จีน|ปักกิ่ง|เซี่ยงไฮ้|ฮ่องกง|ไต้หวัน|สิงคโปร์|มาเลเซีย|ฟิลิปปินส์|เวียดนาม|ลาว|กัมพูชา|พม่า|อินโดนีเซีย|บาหลี|อินเดีย|ดูไบ|รัสเซีย|มอสโก|อังกฤษ|ลอนดอน|ฝรั่งเศส|ปารีส|เยอรมนี|เยอรมัน|อิตาลี|สเปน|ยุโรป|อเมริกา|สหรัฐ|นิวยอร์ก|แอลเอ|ลอสแอนเจลิส|ชิคาโก|ฮาวาย|แคนาดา|ออสเตรเลีย|ซิดนีย์|เมลเบิร์น|นิวซีแลนด์|\b(?:tokyo|japan|korea|seoul|china|london|paris|new york|la|sydney|now)\b)/iu;
const CLOCK_EVENT = /(แข่ง|เตะ|ไฟลท์|เที่ยวบิน|เครื่องบิน|รถไฟ|ตั๋ว|ร้าน|ห้าง|เปิด|ปิด|ถ่ายทอด|คอนเสิร์ต|ประกาศ|ออกอากาศ|นัด|ประชุม|match|flight|game|kick)/iu;
// "ในไฟล์ที่แนบมา…", "เอกสารนี้…": the attached file is already in the message, so no library or web lookup
// (claude-20261023: the word "ไฟล์" sent it to the library, nothing matched, and it searched the web).
// "ที่อัปโหลดไว้" / "ที่แนบไว้" stay library requests (files stored earlier), only files sent with this message count.
const ATTACHED_REF = /((?:ไฟล์|เอกสาร|รูป|ภาพ|pdf|สลิป|ใบเสร็จ)\s*(?:ที่)?\s*(?:แนบ(?:มา|ให้)?(?!\s*ไว้)|ส่ง(?:มา|ให้))|ที่แนบมา|(?:ไฟล์|เอกสาร)นี้|\battached\b|this (?:file|document|pdf)|the (?:file|document) I (?:just )?(?:sent|attached))/iu;
// "วันนี้วันอะไร", "วันที่เท่าไหร่", "พรุ่งนี้วันอะไร", "กี่โมงแล้ว", "ปีนี้ พ.ศ. อะไร", "อีกกี่วันจะถึงปีใหม่": the prompt carries today's
// date and the time (claude-20261023), so these need no web search. Holidays, lunar days and event dates are left to the rules below.
const DATE_ASK = /(วันอะไร|ตรงกับวัน(?:อะไร|ไหน)|วันที่\s*(?:เท่าไ|อะไร|กี่)|วันนี้\s*(?:เป็น)?\s*วันที่\s*\??$|กี่โมง|เวลา\s*(?:เท่าไ|กี่โมง)|(?:ปี|เดือน)\s*(?:นี้|หน้า|ที่แล้ว|ก่อน)\s*(?:เป็น|คือ)?\s*(?:ปี|เดือน)\s*(?:อะไร|ไหน)|(?:พ\.?\s?ศ\.?|ค\.?\s?ศ\.?)\s*(?:อะไร|เท่าไ|ไหน)|(?:อีก|เหลือ(?:อีก)?)\s*กี่\s*(?:วัน|เดือน|สัปดาห์|อาทิตย์|ชั่วโมง|นาที)|กี่วันแล้ว|ผ่าน(?:มา|ไป)(?:แล้ว)?\s*กี่\s*วัน|\bwhat\s+(?:day|date|time)\s+is\s+it\b|\bwhat\s+day\s+is\s+today\b|\bwhat(?:'s|\s+is)\s+(?:the\s+)?(?:date|day|time)\s+(?:today|now)\b|\btoday'?s\s+date\b|\bcurrent\s+(?:date|time)\b)/iu;
const DATE_LOOKUP = /(วันพระ|วันหยุด|หยุด(?:ไหม|มั้ย|หรือเปล่า|ราชการ|ยาว|ชดเชย)|วันสำคัญ|เทศกาล|ลอยกระทง|มาฆ|วิสาข|อาสาฬห|เข้าพรรษา|ออกพรรษา|ตรุษจีน|สารทจีน|เชงเม้ง|ไหว้พระจันทร์|รอมฎอน|ฤกษ์|ดวง|พระอาทิตย์|พระจันทร์|น้ำขึ้น|น้ำลง|ฉาย|เข้าโรง|สอบ|สมัคร|ประกาศผล|วางขาย|เปิดตัว|ไลฟ์|เงินเดือน|หมดเขต|ภาษี|เลือกตั้ง|หวย|สลาก|holiday|sunrise|sunset|release|launch)/iu;
const FX_ASK = /(กี่|เท่าไ[รห]|เป็น|แลก|เรท|อัตรา|\?|=|\bto\b|\bin\b|how much|rate)/iu;
const MONEY = /(บาท|เงิน|ดอลลาร์|เยน|ยูโร|หยวน|วอน|ริงกิต|สเตอร์ลิง|usd|thb|eur|jpy|cny|krw|gbp|bitcoin|บิตคอยน์|ค่าเงิน|อัตราแลกเปลี่ยน|exchange rate|\$|฿|€|£|¥)/iu;

function explicitUrlIntent(query) {
  const match = query.match(/https?:\/\/[^\s<>"']+/iu);
  if (!match) return null;

  const raw = match[0].replace(/[.,!?)}\]]+$/, '');
  const instruction = query.replace(match[0], ' ').trim();

  if (!/(สรุป|อ่าน|เปิด|วิเคราะห์|summarize|summarise|read|open|analyze|analyse)/iu.test(instruction)) {
    return null;
  }

  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
export class DeterministicKnowledgeRouter {
  route(input = {}) {
    const originalQuery = String(input.query ?? '').trim();
    if (!originalQuery) throw new TypeError('Knowledge query is required.');
    if (input.private === true || input.anonymous === true) {
      return this.result('DIRECT', originalQuery, { reason: 'privacy-mode', blocked: true });
    }
    if (input.override && String(input.override).toUpperCase() !== 'AUTO') {
      return this.result(normalizeRoute(input.override), originalQuery, { reason: 'manual-override' });
    }
    let followUp = resolveFollowUp(originalQuery, input.context);
    // "ลองใช้เว็บเสิร์ชหาดู" / "หาในเน็ตใหม่": a search command with little subject of its own searches the
    // previous topic. Always when it has almost no words left; otherwise only right after a web turn.
    if (!followUp.isFollowUp && input.context?.previousQuery && EXPLICIT_WEB.test(originalQuery)) {
      const rest = originalQuery.replace(EXPLICIT_WEB, ' ')
        .replace(/(?:เธอ|คุณ|ช่วย|ลอง|ใช้|ดู|หน่อย|ให้|ใหม่|อีก(?:ที|ครั้ง)?|ที|สิ|นะ|ค่ะ|คะ|ครับ|จ้า|เลย|แล้ว|ก็|หา|ค้น|อยู่|อันนี้|เรื่องนี้|มัน|please|again|it)/giu, '')
        .replace(/[\s?!.,ๆ]+/gu, '');
      const afterWeb = ['WEB', 'HYBRID'].includes(String(input.context.previousRoute ?? '').toUpperCase());
      if (rest.length < 6 || (afterWeb && rest.length < 25))
        followUp = { query: joinFollowUp(String(input.context.previousQuery), originalQuery), isFollowUp: true, stickyRoute: null };
    }
    const query = followUp.query;
    const urlIntent = explicitUrlIntent(originalQuery);
    const fx = FX.test(originalQuery) && FX_ASK.test(originalQuery);
    const local = LOCAL.test(query); const web = WEB.test(query) || EXPLICIT_WEB.test(query) || fx; const memory = MEMORY.test(query);
    // An explicit command in THIS message decides the place to look; it is never widened ("ค้นเว็บ" = web only,
    // "ดูในคลัง" = library only) unless the user names both.
    const explicitWeb = EXPLICIT_WEB.test(originalQuery);
    const explicitLocal = EXPLICIT_LOCAL.test(originalQuery);
    // "แล้วพรุ่งนี้ล่ะ" right after "วันนี้วันอะไร" is still a date question (the joined text carries it).
    const dateText = DATE_ASK.test(originalQuery) ? originalQuery : followUp.isFollowUp && DATE_ASK.test(query) ? query : '';
    let route;
    let reason;
    if (NO_WEB.test(originalQuery)) { route = explicitLocal ? 'LOCAL' : 'DIRECT'; reason = explicitLocal ? 'explicit-local-request' : 'explicit-no-web'; }
    else if (DIRECT.test(originalQuery) || THANKS_ONLY.test(originalQuery)) { route = 'DIRECT'; reason = 'direct-pattern'; }
    else if (urlIntent) { route = 'WEB'; reason = 'explicit-url-fetch'; }
    else if (TEXT_TASK.test(originalQuery) && !local && !EXPLICIT_WEB.test(originalQuery)) { route = 'DIRECT'; reason = 'text-task-no-search'; }
    else if (explicitWeb && explicitLocal) { route = 'HYBRID'; reason = 'explicit-web-and-local'; }
    else if (explicitWeb) { route = 'WEB'; reason = 'explicit-web-request'; }
    else if (explicitLocal) { route = 'LOCAL'; reason = 'explicit-local-request'; }
    else if (ATTACHED_REF.test(originalQuery)) { route = 'DIRECT'; reason = 'attached-file'; }
    else if (CONVERSION.test(originalQuery) && !MONEY.test(originalQuery) && !WEB_TOPIC.test(originalQuery) && !WEB_TIME.test(originalQuery)) { route = 'DIRECT'; reason = 'unit-conversion'; }
    else if (CLOCK.test(originalQuery) && CLOCK_PLACE.test(originalQuery) && !CLOCK_EVENT.test(originalQuery)) { route = 'DIRECT'; reason = 'clock'; }
    else if (dateText && !DATE_LOOKUP.test(dateText) && !CLOCK_EVENT.test(dateText) && !WEB_TOPIC.test(dateText) && !fx) { route = 'DIRECT'; reason = 'date-time'; }
    else if (USER_FIGURES.test(originalQuery) && FIGURE_TASK.test(originalQuery) && !WEB_TIME.test(originalQuery) && !fx) { route = 'DIRECT'; reason = 'user-figures'; }
    else if (WRITE_TASK.test(originalQuery) && !WEB_TIME.test(originalQuery) && !local) { route = 'DIRECT'; reason = 'writing-task'; }
    else if (memory) { route = 'MEMORY'; reason = 'memory-reference'; }
    else if (local && web) { route = 'HYBRID'; reason = 'local-and-fresh'; }
    else if (local) { route = 'LOCAL'; reason = 'local-reference'; }
    else if (web && !ROLEPLAY.test(query)) { route = 'WEB'; reason = EXPLICIT_WEB.test(query) ? 'explicit-web-request' : 'freshness-required'; }
    else if (followUp.stickyRoute) { route = normalizeRoute(followUp.stickyRoute); reason = 'sticky-follow-up'; }
    else { route = 'DIRECT'; reason = ROLEPLAY.test(query) ? 'roleplay-no-search' : 'no-knowledge-signal'; }
    return this.result(route, query, { reason, isFollowUp: followUp.isFollowUp, targetUrl: reason === 'explicit-url-fetch' ? urlIntent : null });
  }
  result(route, resolvedQuery, detail) {
    return Object.freeze({ route, resolvedQuery, mode: detail.reason === 'manual-override' ? 'manual' : 'auto',
      reason: detail.reason, targetUrl: detail.targetUrl ?? null, isFollowUp: detail.isFollowUp === true, blocked: detail.blocked === true });
  }
}


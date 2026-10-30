/**
 * Today's date and the time on this computer, for the per-turn context (claude-20261023).
 * Lets the assistant answer "วันนี้วันอะไร", "วันที่เท่าไหร่", "กี่โมงแล้ว", "พรุ่งนี้วันอะไร" without a web search.
 * It is a volatile section (appended to the latest user turn), so the cached system prompt never changes with the clock.
 */
const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface ClockParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number; offsetMinutes: number; timeZone: string }

function systemTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/** Calendar date, wall-clock time, weekday (0 = Sunday) and UTC offset of `now` in `timeZone` (default: this computer's zone). */
export function clockParts(now: Date, timeZone?: string): ClockParts {
  const zone = timeZone || systemTimeZone();
  let p: Record<string, number>;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    p = Object.fromEntries(fmt.formatToParts(now).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  } catch (error) {
    if (zone !== 'UTC') return clockParts(now, 'UTC'); // unknown zone name
    throw error;
  }
  const hour = p.hour % 24;
  const minuteStart = Math.floor(now.getTime() / 60000) * 60000;
  const offsetMinutes = Math.round((Date.UTC(p.year, p.month - 1, p.day, hour, p.minute) - minuteStart) / 60000);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return { year: p.year, month: p.month, day: p.day, hour, minute: p.minute, weekday, offsetMinutes, timeZone: zone };
}

/** How Thai people say a time: 8 โมงเช้า, 8 โมง 35 นาที, บ่าย 2 โมงครึ่ง, 4 โมงเย็น, 2 ทุ่ม, ตี 3, เที่ยงคืน. */
export function thaiClock(hour: number, minute: number): string {
  const h = ((hour % 24) + 24) % 24;
  const word = h === 0 ? 'เที่ยงคืน'
    : h <= 5 ? `ตี ${h}`
    : h <= 11 ? `${h} โมง${minute === 0 ? 'เช้า' : ''}`
    : h === 12 ? 'เที่ยง'
    : h === 13 ? 'บ่ายโมง'
    : h <= 15 ? `บ่าย ${h - 12} โมง`
    : h <= 18 ? `${h - 12} โมงเย็น`
    : `${h - 18} ทุ่ม`;
  return minute === 0 ? word : minute === 30 ? `${word}ครึ่ง` : `${word} ${minute} นาที`;
}

const two = (n: number) => String(n).padStart(2, '0');
const utcLabel = (m: number) => `UTC${m < 0 ? '-' : '+'}${Math.floor(Math.abs(m) / 60)}${Math.abs(m) % 60 ? `:${two(Math.abs(m) % 60)}` : ''}`;

/** The "[Date & Time]" turn-context text. */
export function dateTimeContext(now: Date, timeZone?: string): string {
  const c = clockParts(now, timeZone);
  return [
    `วันนี้: วัน${TH_DAYS[c.weekday]}ที่ ${c.day} ${TH_MONTHS[c.month - 1]} พ.ศ. ${c.year + 543} (${EN_DAYS[c.weekday]} ${c.day} ${EN_MONTHS[c.month - 1]} ${c.year}, ${c.year}-${two(c.month)}-${two(c.day)})`,
    `เวลาตอนนี้: ${two(c.hour)}:${two(c.minute)} น. (${thaiClock(c.hour, c.minute)}) - local time of this computer, ${c.timeZone} (${utcLabel(c.offsetMinutes)})`,
    'Use this when the user asks about today, the date, the day of the week, the time, or how many days until or since a date. No web search is needed for these. Do not bring up the date or time unless it helps the reply.',
  ].join('\n');
}

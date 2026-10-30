// claude-20261025: scheduled agent jobs (user: "ทำให้ lumicos เป็น Agent ในส่วนอื่นต่อได้เลย"). Reading the schedule out of a Thai
// message, when a rule fires (Bangkok time), labels, and the chat commands that list / cancel / run schedules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWhen, withoutWhen, findTime, nextRun, lastDue, describeRule, formatWhen, sameDay, dayStart, scheduleCommand, pickSchedules } from '../agent/schedule.mjs';

const bkk = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 7 * 3_600_000;
const NOW = bkk(2026, 10, 25, 4, 30); // Sunday 25 Oct 2026, 04:30 Thai time
const when = (text, now = NOW) => { const r = parseWhen(text, now); return r && { rule: describeRule(r.rule), job: withoutWhen(text, r.spans), guessed: r.timeGuessed }; };

test('times of day the way Thai people say them', () => {
  const at = (t) => { const r = findTime(t); return r && `${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')}`; };
  assert.equal(at('7 โมงเช้า'), '07:00');
  assert.equal(at('สี่โมงเช้า'.replace('สี่', '4')), '10:00', 'traditional: 4 โมงเช้า = 10:00 (same as the world-time skill)');
  assert.equal(at('4 โมง'), '16:00');
  assert.equal(at('8 โมงครึ่ง'), '08:30');
  assert.equal(at('6 โมงเย็น'), '18:00');
  assert.equal(at('บ่าย 2'), '14:00');
  assert.equal(at('บ่ายโมง'), '13:00');
  assert.equal(at('2 ทุ่ม'), '20:00');
  assert.equal(at('ตี 5'), '05:00');
  assert.equal(at('เที่ยง'), '12:00');
  assert.equal(at('เที่ยงคืน'), '00:00');
  assert.equal(at('21:30'), '21:30');
  assert.equal(at('เวลา 7.30'), '07:30');
  assert.equal(at('7.30 น.'), '07:30');
  assert.equal(at('9pm'), '21:00');
  for (const t of ['ROCm 10.10', 'ราคา 45.50 บาท', 'ทุ่มเทให้งาน', 'ความเที่ยงตรง', 'ตีพิมพ์'])
    assert.equal(at(t), null, `"${t}" is not a time`);
});

test('recurring schedules: every day, a part of the day, given days, weekdays, weekends, every week', () => {
  assert.deepEqual(when('ทุกเช้า 7 โมง สรุปข่าว AI ให้หน่อย'), { rule: 'ทุกวัน 07:00', job: 'สรุปข่าว AI ให้หน่อย', guessed: false });
  assert.deepEqual(when('ทุกวัน 6 โมงเช้า สรุปข่าว AI ให้หน่อย').rule, 'ทุกวัน 06:00');
  assert.deepEqual(when('ทุกเย็น 6 โมง สรุปราคาทองให้หน่อย'), { rule: 'ทุกวัน 18:00', job: 'สรุปราคาทองให้หน่อย', guessed: false }, '"ทุกเย็น" puts a bare 6 โมง in the evening');
  assert.equal(when('ทุกคืน 4 ทุ่ม สรุปข่าวให้หน่อย').rule, 'ทุกวัน 22:00');
  assert.deepEqual(when('ทุกวันจันทร์ 9 โมง ค้นเรื่อง ROCm แล้วเก็บเข้าคลัง'), { rule: 'ทุกวันจันทร์ 09:00', job: 'ค้นเรื่อง ROCm แล้วเก็บเข้าคลัง', guessed: false });
  assert.equal(when('ทุกวันจันทร์และพฤหัส 8 โมงครึ่ง สรุปข่าวเทคโนโลยี').rule, 'ทุกวันจันทร์/พฤหัสบดี 08:30');
  assert.equal(when('ทุกวันธรรมดา 7:45 สรุปข่าวหุ้นไทยให้หน่อย').rule, 'วันธรรมดา (จันทร์–ศุกร์) 07:45');
  assert.equal(when('ทุกวันจันทร์ถึงศุกร์ 8 โมง สรุปข่าว').rule, 'วันธรรมดา (จันทร์–ศุกร์) 08:00');
  assert.equal(when('ทุกเสาร์อาทิตย์ 10 โมง สรุปข่าวบันเทิง').rule, 'ทุกเสาร์–อาทิตย์ 10:00');
  assert.equal(when('ทุกวันศุกร์ บ่ายสาม อัปเดตเรื่อง Gemma 4 ในคลัง').rule, 'ทุกวันศุกร์ 15:00');
  assert.equal(when('ทุกวันอาทิตย์ 2 ทุ่ม สรุปข่าว AI').rule, 'ทุกวันอาทิตย์ 20:00');
  const week = parseWhen('ทุกอาทิตย์ สรุปข่าว AI ให้หน่อย', NOW);
  assert.equal(describeRule(week.rule), 'ทุกวันจันทร์ 07:00', '"ทุกอาทิตย์" alone means every week: Monday by default');
  assert.equal(week.rule.weekDefault, true);
  assert.equal(week.timeGuessed, true);
  assert.deepEqual(when('ทุกวัน สรุปข่าว AI'), { rule: 'ทุกวัน 07:00', job: 'สรุปข่าว AI', guessed: true });
  assert.equal(when('ทุกวัน เจ็ดโมงเช้า สรุปข่าวไอที').rule, 'ทุกวัน 07:00');
  assert.deepEqual(when('ช่วยสรุปข่าว AI ให้ทุกเช้า 7 โมงหน่อย'), { rule: 'ทุกวัน 07:00', job: 'ช่วยสรุปข่าว AI หน่อย', guessed: false });
});

test('one-off times: in N minutes, tonight, tomorrow, next Friday', () => {
  const at = (text) => { const r = parseWhen(text, NOW); return r && formatWhen(r.rule.at, NOW); };
  assert.equal(at('อีก 5 นาที สรุปข่าว AI ให้หน่อย'), 'วันนี้ 04:35');
  assert.equal(at('อีก 2 ชั่วโมง สรุปข่าว'), 'วันนี้ 06:30');
  assert.equal(at('พรุ่งนี้เช้า ค้นเรื่อง X แล้วเก็บเข้าคลัง'), 'พรุ่งนี้ 07:00');
  assert.equal(at('พรุ่งนี้ 9 โมง อัปเดตเรื่อง ROCm 10 ในคลัง'), 'พรุ่งนี้ 09:00');
  assert.equal(at('คืนนี้ 3 ทุ่ม สรุปข่าวให้หน่อย'), 'วันนี้ 21:00');
  assert.equal(at('เย็นนี้สรุปข่าวให้หน่อย'), 'วันนี้ 18:00');
  assert.equal(at('วันศุกร์หน้า 9 โมง สรุปข่าว AI'), 'ศ. 30 ต.ค. 09:00');
  assert.equal(at('วันอาทิตย์หน้า 9 โมง สรุปข่าว AI'), 'อา. 1 พ.ย. 09:00', 'next Sunday said on a Sunday is a week away');
  assert.equal(at('มะรืน บ่าย 2 สรุปข่าว'), 'อ. 27 ต.ค. 14:00');
  assert.equal(parseWhen('อีก 9 วัน สรุปข่าว', NOW), null);
});

test('a question about today or nowadays is not a schedule', () => {
  for (const t of ['สรุปข่าว AI วันนี้ให้หน่อย', 'ทุกวันนี้ AI พัฒนาเร็วมาก สรุปข่าว AI ให้หน่อย', 'พรุ่งนี้ฝนจะตกไหม', 'ข่าว AI ล่าสุด', 'ค้นเรื่อง ROCm แล้วเก็บเข้าคลัง'])
    assert.equal(parseWhen(t, NOW), null, t);
  // job words that look like times or parts of the day stay in the job
  assert.deepEqual(when('ทุกวันจันทร์ ค้นเรื่อง ROCm 10.10 แล้วเก็บเข้าคลัง'), { rule: 'ทุกวันจันทร์ 07:00', job: 'ค้นเรื่อง ROCm 10.10 แล้วเก็บเข้าคลัง', guessed: true });
  assert.equal(when('ทุกวันจันทร์ ค้นเรื่องการคืนเงินภาษีแล้วเก็บเข้าคลัง').rule, 'ทุกวันจันทร์ 07:00', '"คืนเงิน" is not night');
});

test('next and last run in Bangkok time; a weekly rule skips other days', () => {
  const daily = { type: 'daily', hour: 7, minute: 0 };
  assert.equal(formatWhen(nextRun(daily, NOW), NOW), 'วันนี้ 07:00');
  assert.equal(lastDue(daily, NOW), bkk(2026, 10, 24, 7, 0), 'before 07:00 the last run was yesterday');
  assert.equal(lastDue(daily, bkk(2026, 10, 25, 7, 0)), bkk(2026, 10, 25, 7, 0), 'exactly at the time counts');
  const monday = { type: 'weekly', days: [1], hour: 9, minute: 0 };
  assert.equal(nextRun(monday, NOW), bkk(2026, 10, 26, 9, 0));
  assert.equal(lastDue(monday, NOW), bkk(2026, 10, 19, 9, 0));
  const once = { type: 'once', at: bkk(2026, 10, 25, 18, 0) };
  assert.equal(nextRun(once, NOW), once.at);
  assert.equal(lastDue(once, NOW), null);
  assert.equal(nextRun(once, bkk(2026, 10, 25, 19, 0)), null);
  assert.ok(sameDay(bkk(2026, 10, 25, 0, 1), bkk(2026, 10, 25, 23, 59)));
  assert.ok(!sameDay(bkk(2026, 10, 25, 23, 59), bkk(2026, 10, 26, 0, 1)));
  assert.equal(dayStart(NOW), bkk(2026, 10, 25));
});

test('labels for rules and times', () => {
  assert.equal(describeRule({ type: 'weekly', days: [0, 6], hour: 10, minute: 0 }), 'ทุกเสาร์–อาทิตย์ 10:00');
  assert.equal(describeRule({ type: 'weekly', days: [5, 1, 3], hour: 9, minute: 5 }), 'ทุกวันจันทร์/พุธ/ศุกร์ 09:05');
  assert.equal(describeRule({ type: 'once', at: bkk(2026, 10, 27, 9, 0) }), 'ครั้งเดียว อ. 27 ต.ค. 09:00');
  assert.equal(formatWhen(bkk(2026, 10, 26, 7, 0), NOW), 'พรุ่งนี้ 07:00');
  assert.equal(formatWhen(bkk(2026, 11, 2, 7, 0), NOW), 'จ. 2 พ.ย. 07:00');
});

test('chat commands for schedules: list, cancel, run now', () => {
  for (const t of ['ดูงานที่ตั้งเวลาไว้', 'มีงานตั้งเวลาอะไรบ้าง', 'งานตั้งเวลาทั้งหมด', 'ตั้งเวลาอะไรไว้บ้าง', 'ขอดูรายการงานที่ตั้งเวลาไว้หน่อย', 'list scheduled jobs'])
    assert.deepEqual(scheduleCommand(t), { kind: 'schedule-list' }, t);
  assert.deepEqual(scheduleCommand('ยกเลิกงานตั้งเวลาข้อ 2'), { kind: 'schedule-cancel', target: 'ข้อ 2' });
  assert.deepEqual(scheduleCommand('ลบงานตั้งเวลาทั้งหมด'), { kind: 'schedule-cancel', target: 'ทั้งหมด' });
  assert.deepEqual(scheduleCommand('ยกเลิกงานที่ตั้งเวลาไว้เรื่องสรุปข่าว AI ให้หน่อย'), { kind: 'schedule-cancel', target: 'สรุปข่าว AI' });
  assert.deepEqual(scheduleCommand('ยกเลิกงานตั้งเวลา'), { kind: 'schedule-cancel', target: '' });
  assert.deepEqual(scheduleCommand('ทำงานตั้งเวลาข้อ 1 ตอนนี้เลย'), { kind: 'schedule-run', target: 'ข้อ 1' });
  assert.deepEqual(scheduleCommand('รันงานตั้งเวลาสรุปข่าว AI เดี๋ยวนี้'), { kind: 'schedule-run', target: 'สรุปข่าว AI' });
  assert.deepEqual(scheduleCommand('ลองทำงานตั้งเวลาตอนนี้เลย'), { kind: 'schedule-run', target: '' });
  for (const t of ['ตั้งเวลาปลุกให้หน่อย', 'งานวันนี้เยอะมาก', 'ยกเลิกงานค้นคว้า']) assert.equal(scheduleCommand(t), null, t);
  const list = [{ id: 'a', topic: 'AI', label: 'สรุปข่าว “AI”' }, { id: 'b', topic: 'ROCm', label: 'ค้นคว้า “ROCm” → คลังความรู้' }];
  assert.deepEqual(pickSchedules(list, 'ข้อ 2').map((s) => s.id), ['b']);
  assert.deepEqual(pickSchedules(list, '1').map((s) => s.id), ['a']);
  assert.deepEqual(pickSchedules(list, 'ทั้งหมด').map((s) => s.id), ['a', 'b']);
  assert.deepEqual(pickSchedules(list, 'สรุปข่าว AI').map((s) => s.id), ['a']);
  assert.deepEqual(pickSchedules(list, 'rocm').map((s) => s.id), ['b']);
  assert.deepEqual(pickSchedules(list, '').map((s) => s.id), [], 'two schedules and no target: ask which');
  assert.deepEqual(pickSchedules([list[0]], '').map((s) => s.id), ['a'], 'only one: that one');
  assert.deepEqual(pickSchedules(list, 'ข้อ 5'), []);
});

test('"ทุก N โมง" / "ทุก 08.30 น." is every day at that time (fix 20261026)', () => {
  const at = (t) => { const w = parseWhen(t, Date.UTC(2026, 9, 26)); return w && `${w.rule.type} ${w.rule.hour}:${w.rule.minute}`; };
  assert.equal(at('ตั้งเวลา สรุปข่าว AI ทุก 9 โมงเช้า'), 'daily 9:0');
  assert.equal(at('ทุก 2 ทุ่ม สรุปข่าว AI'), 'daily 20:0');
  assert.equal(at('สรุปข่าว AI ทุก 08.30 น.'), 'daily 8:30');
  assert.equal(parseWhen('ทุก 2 ชั่วโมง สรุปข่าว AI'), null);
});

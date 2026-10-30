import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkillStore } from '../tools/sandboxTools.mjs';
import { triggerHits, matchSkill, buildSkillGuide, skillScriptPath } from '../tools/skillMatch.mjs';

test('Thai triggers match anywhere; English triggers only as whole words', () => {
  assert.deepEqual(triggerHits('คิด VAT 7% ของ 1,500 บาท', ['vat', 'ส่วนลด']), ['vat']);
  assert.deepEqual(triggerHits('this is private', ['vat']), []);
  assert.deepEqual(triggerHits('ขอส่วนลดหน่อย', ['ส่วนลด']), ['ส่วนลด']);
  assert.deepEqual(triggerHits('อะไรก็ได้', []), []);
});

test('the skill with more (and longer) hits wins; no hit gives null', () => {
  const skills = [{ name: 'a', triggers: ['ผ่อน'] }, { name: 'b', triggers: ['ผ่อนรถ', 'ค่างวด'], hasScript: true }];
  assert.equal(matchSkill('ผ่อนรถค่างวดเท่าไหร่', skills).name, 'b');
  assert.equal(matchSkill('ผ่อนรถค่างวดเท่าไหร่', skills).hasScript, true);
  assert.equal(matchSkill('สวัสดี', skills), null);
});

test('SkillStore keeps trigger words when a skill is re-saved without them, and lists them', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new SkillStore(root);
  store.save({ name: 'tip-calc', description: 'คิดทิป', instructions: '1. คูณ', triggers: 'ทิป, tip' });
  store.save({ name: 'tip-calc', description: 'คิดทิปแบบใหม่', instructions: '1. คูณแล้วปัด' });
  const row = store.list().find((s) => s.name === 'tip-calc');
  assert.deepEqual(row.triggers, ['ทิป', 'tip']);
  assert.equal(row.hasScript, false);
  store.save({ name: 'tip-calc', description: 'x', instructions: 'y', triggers: ['ค่าทิป'], files: { 'script.py': 'def f(): pass' } });
  const again = store.list().find((s) => s.name === 'tip-calc');
  assert.deepEqual(again.triggers, ['ค่าทิป']);
  assert.equal(again.hasScript, true);
  const guide = buildSkillGuide(store, matchSkill('ช่วยคิดค่าทิปหน่อย', store.list()));
  assert.match(guide, /Saved skill "tip-calc" matches this message \(it mentions: ค่าทิป\)/);
  assert.match(guide, /exec\(open\("skills\/tip-calc\/script\.py"/);
  assert.ok(!guide.includes('description:'), 'front matter is not repeated');
  assert.match(guide, /without mentioning the skill/, 'the model is told to use the skill quietly');
});

test('the shipped skills fire on the right messages and stay quiet on unrelated ones', (t) => {
  const ws = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'workspace');
  if (!fs.existsSync(path.join(ws, 'skills', 'vat-and-discount', 'SKILL.md'))) return t.skip('no workspace skills here');
  const list = new SkillStore(ws).list();
  const pick = (text) => matchSkill(text, list)?.name ?? null;
  assert.equal(pick('คิด VAT 7% ของ 1,500 บาทให้หน่อย'), 'vat-and-discount');
  assert.equal(pick('100 ไมล์ กี่กิโลเมตร'), 'unit-convert');
  assert.equal(pick('1,234.50 บาท เขียนเป็นตัวหนังสือให้หน่อย'), 'thai-baht-text');
  assert.equal(pick('ผ่อนรถ 500,000 ดอกเบี้ย 3% 5 ปี ค่างวดเท่าไหร่'), 'calculate-loan-installment');
  assert.equal(pick('วันที่ 5 ธันวาคม 2569 อีกกี่วัน'), 'thai-date-tools');
  assert.equal(pick('หารค่าอาหาร 1,250 บาท 4 คน คนละเท่าไหร่'), 'split-bill');
  assert.equal(pick('กินชาบู 2,000 บวกเซอร์วิสชาร์จ 10% VAT 7% หาร 4 คน'), 'split-bill');
  assert.equal(pick('แอร์ 12000 btu เปิดวันละ 8 ชั่วโมง ค่าไฟเดือนละเท่าไหร่'), 'power-cost');
  assert.equal(pick('ตอนนี้ที่ญี่ปุ่นกี่โมง'), 'world-time');
  assert.equal(pick('3 ทุ่มบ้านเรา ลอนดอนกี่โมง'), 'world-time');
  assert.equal(pick('ออมเดือนละ 5,000 ดอกเบี้ย 2% 10 ปีได้เท่าไหร่'), 'savings-growth');
  // claude-20261023: world-time needs a place outside Thailand; the time here comes from the clock in the prompt.
  assert.equal(pick('ตอนนี้กี่โมงแล้ว'), null);
  assert.equal(pick('what time is it'), null);
  assert.equal(pick('ญี่ปุ่นตอนนี้กี่โมง'), 'world-time');
  assert.equal(pick('what time is it in London'), 'world-time');
  assert.equal(pick('3 ทุ่มที่ไทย เป็นกี่โมงที่โตเกียว'), 'world-time');
  // the Real Chat Check questions (numbers differ from the SKILL.md examples on purpose)
  assert.equal(pick('คิด VAT 7% ของ 2,350 บาทให้หน่อย ราคานี้ยังไม่รวม VAT'), 'vat-and-discount');
  assert.equal(pick('65 ไมล์ กี่กิโลเมตร'), 'unit-convert');
  assert.equal(pick('4,705.25 บาท เขียนเป็นตัวหนังสือให้หน่อย'), 'thai-baht-text');
  assert.equal(pick('กินหมูกระทะ 1,850 บาท บวกเซอร์วิสชาร์จ 10% กับ VAT 7% หาร 3 คน คนละเท่าไหร่'), 'split-bill');
  assert.equal(pick('เครื่องทำน้ำอุ่น 3,500 วัตต์ ใช้วันละ 30 นาที ค่าไฟเดือนละเท่าไหร่ คิดหน่วยละ 4.5 บาท'), 'power-cost');
  assert.equal(pick('ออมเดือนละ 3,000 ดอกเบี้ย 1.5% ต่อปี 5 ปี ได้เงินรวมเท่าไหร่'), 'savings-growth');
  // claude-20261024: new skills (percent-calc, unit-price, trip-fuel-cost, bmi); "17.5% ของ 2,340" was answered 4,095 without one.
  assert.equal(pick('ช่วยคำนวณ 17.5% ของ 2,340 บาท'), 'percent-calc');
  assert.equal(pick('จาก 1,250 เป็น 1,400 เพิ่มขึ้นกี่เปอร์เซ็นต์'), 'percent-calc');
  assert.equal(pick('45 คิดเป็นกี่ % ของ 180'), 'percent-calc');
  assert.equal(pick('คิด VAT 7% ของ 980 บาทให้หน่อย ราคานี้ยังไม่รวม VAT'), 'vat-and-discount', '"unless: vat" keeps percent-calc away');
  assert.equal(pick('ลดราคา 15% จาก 2,000'), 'vat-and-discount');
  assert.equal(pick('น้ำดื่มขวด 1.5 ลิตร 14 บาท กับแพ็ค 12 ขวด ขวดละ 600 มล. 79 บาท อันไหนคุ้มกว่า'), 'unit-price');
  assert.equal(pick('ขับรถไปเชียงใหม่ 690 กม. รถกินน้ำมัน 15 กม./ลิตร ดีเซลลิตรละ 32.94 ไปกลับค่าน้ำมันเท่าไหร่'), 'trip-fuel-cost');
  assert.equal(pick('สูง 168 ซม. หนัก 72 กิโล BMI เท่าไหร่'), 'bmi');
  for (const text of ['แบตเหลือกี่เปอร์เซ็นต์', 'ซื้อที่ไหนคุ้มกว่า', 'ค่าน้ำมันวันนี้เท่าไหร่', 'ค้นเว็บ ราคาน้ำมันดีเซลวันนี้', 'BMI คืออะไร'])
    assert.equal(pick(text), null, text);
  for (const text of ['สภาพอากาศกรุงเทพวันนี้', 'สร้างภาพแมวสีส้ม', 'ค้นเว็บ ราคาทองวันนี้', 'สวัสดี เธอชื่ออะไร', 'this is private', 'ร้านเปิดกี่โมง', 'แมนยูแข่งกี่โมง', 'วันนี้เหนื่อยจัง']) assert.equal(pick(text), null, text);
});

test('a skill with "unless:" stays quiet when one of those words is in the message; re-saving keeps them', (t) => {
  const skills = [{ name: 'percent-calc', triggers: ['% ของ'], unless: ['vat'] }, { name: 'vat-and-discount', triggers: ['vat'] }];
  assert.equal(matchSkill('ช่วยคิด 12% ของ 500', skills).name, 'percent-calc');
  assert.equal(matchSkill('คิด VAT 7% ของ 980', skills).name, 'vat-and-discount');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'skills', 'pct-x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'pct-x', 'SKILL.md'), '---\nname: pct-x\ndescription: เปอร์เซ็นต์\ntriggers: % ของ\nunless: vat, ดอกเบี้ย\n---\n\n1. รัน\n');
  const store = new SkillStore(root);
  assert.deepEqual(store.list().find((s) => s.name === 'pct-x').unless, ['vat', 'ดอกเบี้ย']);
  store.save({ name: 'pct-x', description: 'เปอร์เซ็นต์ใหม่', instructions: '1. รันใหม่' });
  assert.deepEqual(store.list().find((s) => s.name === 'pct-x').unless, ['vat', 'ดอกเบี้ย'], 'Lumicos re-saving the skill keeps its unless list');
});

test('a skill with "needs:" fires only when one of those words is in the message too; re-saving keeps them', (t) => {
  const skills = [{ name: 'world-time', triggers: ['ตอนนี้กี่โมง'], needs: ['ญี่ปุ่น', 'london'] }];
  assert.equal(matchSkill('ตอนนี้กี่โมงแล้ว', skills), null);
  assert.equal(matchSkill('ญี่ปุ่นตอนนี้กี่โมง', skills).name, 'world-time');
  assert.equal(matchSkill('ตอนนี้กี่โมง ที่ London', skills).name, 'world-time');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'skills', 'clock-x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'clock-x', 'SKILL.md'), '---\nname: clock-x\ndescription: เวลา\ntriggers: กี่โมง\nneeds: ญี่ปุ่น, โซล\n---\n\n1. รัน\n');
  const store = new SkillStore(root);
  assert.deepEqual(store.list().find((s) => s.name === 'clock-x').needs, ['ญี่ปุ่น', 'โซล']);
  store.save({ name: 'clock-x', description: 'เวลาใหม่', instructions: '1. รันใหม่' });
  assert.deepEqual(store.list().find((s) => s.name === 'clock-x').needs, ['ญี่ปุ่น', 'โซล'], 'Lumicos re-saving the skill keeps its needs');
});

test('the guide shows both lines of the run_python code', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new SkillStore(root);
  store.save({ name: 'tip-calc', description: 'คิดทิป', instructions: '1. tip(100, 10)', triggers: 'ค่าทิป', files: { 'script.py': 'def tip(a, p):\n    return a * p / 100' } });
  const guide = buildSkillGuide(store, matchSkill('ช่วยคิดค่าทิปหน่อย', store.list()));
  assert.match(guide, /exec\(open\("skills\/tip-calc\/script\.py", encoding="utf-8"\)\.read\(\)\)\nprint\(/, 'exec line followed by a print line');
  assert.match(guide, /has NOT been run yet/);
  assert.match(guide, /only loads the functions and prints nothing/);
});

test('"output: exact" is read, kept when Lumicos re-saves the skill, and passed along with the match', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'skills', 'baht-x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'baht-x', 'SKILL.md'), '---\nname: baht-x\ndescription: คำอ่าน\ntriggers: เป็นตัวหนังสือ\noutput: exact\n---\n\n1. รัน\n');
  fs.writeFileSync(path.join(root, 'skills', 'baht-x', 'script.py'), 'def baht(a):\n    return a\n');
  const store = new SkillStore(root);
  assert.equal(store.list().find((s) => s.name === 'baht-x').exactOutput, true);
  const m = matchSkill('100 บาท เขียนเป็นตัวหนังสือ', store.list());
  assert.equal(m.exactOutput, true);
  assert.equal(skillScriptPath(store, 'baht-x'), 'skills/baht-x/script.py');
  store.save({ name: 'baht-x', description: 'คำอ่านใหม่', instructions: '1. รันใหม่' });
  assert.equal(store.list().find((s) => s.name === 'baht-x').exactOutput, true, 'kept on re-save');
  assert.match(buildSkillGuide(store, m), /If it shows an error, fix the call and run it again/);
  const ws = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'workspace');
  if (fs.existsSync(path.join(ws, 'skills', 'thai-baht-text', 'SKILL.md'))) {
    const shipped = new SkillStore(ws).list();
    assert.equal(shipped.find((s) => s.name === 'thai-baht-text').exactOutput, true);
    assert.equal(shipped.find((s) => s.name === 'power-cost').exactOutput, false, 'calculators keep their own wording');
  }
});

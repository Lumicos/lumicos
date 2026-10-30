// claude-20261025: agent jobs that make files (user: "การวางแผนทริปเที่ยว ทำเอ็กเซลการขายสินค้า ทำแบบทดสอบภาษาจีนแบบมีคำตอบ ABCD"):
// a researched trip plan (Word), an ABCD quiz with a separate answer key (Word + Excel), a sales workbook with formulas
// (Excel, no model). Parsers, the bounded checks, and the server chat path with a fake model, web and a real workspace.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { tripAsk, tripQueries, dayChunks, parsePlan, checkPlan, keepPlan, namedIn, runTrip, tripReport, allowedNumbers, tripXlsx, priceOf } from '../agent/trip.mjs';
import { quizAsk, parseQuestions, checkQuestion, parseAnswers, balanceAnswers, runQuiz, quizReport, letterSpread } from '../agent/quiz.mjs';
import { salesAsk, productsIn, salesWorkbook, salesFileName } from '../agent/sales.mjs';
import { researchTopic, updateTopic, briefTopic } from '../agent/research.mjs';
import { fileSlug } from '../agent/outputs.mjs';
import { AgentService, labelOf } from '../agent/agentService.mjs';
import { ConversationStore } from '../chat/conversationStore.mjs';
import { ChatService } from '../chat/chatService.mjs';
import { ModelService } from '../llama/modelService.mjs';
import { FileService } from '../files/fileService.mjs';
import { Workspace } from '../files/paths.mjs';
import * as runtime from '../../.runtime/chat.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, what, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(5)) if (check()) return;
  assert.fail(`timed out waiting for ${what}`);
}

// ---- a small travel web and a model that answers by prompt ---------------------------------------------------
const WEB = {
  'ที่เที่ยวเชียงใหม่ ยอดนิยม': [['20 ที่เที่ยวเชียงใหม่', 'https://a.example/1', 'วัดพระธาตุดอยสุเทพราชวรวิหาร ค่าเข้าชาวต่างชาติ 30 บาท ขึ้นรถแดงจากประตูช้างเผือก ถนนนิมมานเหมินท์ย่านคาเฟ่ และวัดเจดีย์หลวงใจกลางเมืองเก่า'],
    ['ม่อนแจ่ม', 'https://a.example/2', 'ม่อนแจ่ม อำเภอแม่ริม จุดชมวิวทะเลหมอก ค่ายานพาหนะ 20 บาท มีที่พักแบบกางเต็นท์ราคา 300 บาทต่อคืน เหมาะกับช่วงหน้าหนาว']],
  'เที่ยวเชียงใหม่ 3 วัน 2 คืน': [['แพลนเที่ยวเชียงใหม่ 3 วัน 2 คืน', 'https://b.example/1', 'วันแรกไหว้พระวัดพระสิงห์ เดินถนนคนเดินวันอาทิตย์ท่าแพ วันที่สองขึ้นดอยอินทนนท์ ค่าเข้าอุทยาน 50 บาท วันสุดท้ายช้อปที่กาดหลวง (ตลาดวโรรส)']],
  'ร้านอาหารเชียงใหม่ แนะนำ': [['ร้านข้าวซอยเชียงใหม่', 'https://c.example/1', 'ข้าวซอยแม่สาย ชามละ 50 บาท ข้าวซอยลำดวนฟ้าฮ่าม ร้านเก่าแก่ ชามละ 60 บาท และร้านเฮือนม่วนใจ๋ อาหารเหนือ ขันโตก']],
  'ค่าใช้จ่าย เที่ยวเชียงใหม่ ราคา': [['งบเที่ยวเชียงใหม่', 'https://d.example/1', 'ตั๋วเครื่องบินไปกลับเริ่มต้น 1,500 บาท ที่พักในเมืองคืนละ 800-1,200 บาท เช่ารถมอเตอร์ไซค์วันละ 250 บาท']],
};
const webSearch = async (q) => (WEB[q] ?? []).map(([title, url, snippet], i) => ({ id: String(i + 1), title, url, snippet }));
// sources come out as 1 a1 · 2 b1 · 3 c1 · 4 d1 · 5 a2 (one result from each search in turn)
const PLAN = `สรุป: เที่ยวเชียงใหม่ 3 วัน เน้นวัด ดอย และข้าวซอย
## วันที่ 1: เมืองเก่า
- เช้า: วัดพระธาตุดอยสุเทพราชวรวิหาร ค่าเข้า 30 บาท [1]
- กลางวัน: ข้าวซอยแม่สาย ชามละ 50 บาท [3]
- บ่าย: วัดเจดีย์หลวง [1]
- เย็น: ถนนคนเดินวันอาทิตย์ท่าแพ [2]
## วันที่ 2: ดอยอินทนนท์
- เช้า: ดอยอินทนนท์ ค่าเข้า 50 บาท [2]
- กลางวัน: ร้านลับแลคาเฟ่ดอย [2]
- บ่าย: ม่อนแจ่ม ค่ายานพาหนะ 25 บาท [5]
- เย็น: พักผ่อนที่ที่พัก
## วันที่ 3: ช้อปของฝาก
- เช้า: กาดหลวง ตลาดวโรรส [2]
- กลางวัน: ข้าวซอยลำดวนฟ้าฮ่าม [3]
- บ่าย: เดินทางกลับ
## งบประมาณ
- ตั๋วเครื่องบินไปกลับ: เริ่มต้น 1,500 บาท [4]
- ที่พักในเมือง: คืนละ 800-1,200 บาท [4]
- รวมทั้งหมดประมาณ 8,000 บาท
## เคล็ดลับ
- ไปช่วงหน้าหนาวจะเห็นทะเลหมอกที่ม่อนแจ่ม [5]
- เตรียมเสื้อกันหนาว`;
const PLAN_FIXED = PLAN.replace('- กลางวัน: ร้านลับแลคาเฟ่ดอย [2]', '- กลางวัน: เวลาอิสระ').replace('ค่ายานพาหนะ 25 บาท [5]', 'ค่ายานพาหนะ 20 บาท [5]');
const NUMBERS = [['一', 'หนึ่ง'], ['二', 'สอง'], ['三', 'สาม'], ['四', 'สี่'], ['五', 'ห้า'], ['六', 'หก'], ['七', 'เจ็ด'], ['八', 'แปด'], ['九', 'เก้า'], ['十', 'สิบ'], ['百', 'ร้อย'], ['千', 'พัน']];
let quizRound = 0;
function modelFor(messages) {
  const sys = messages[0].content, user = messages.at(-1).content;
  if (sys.startsWith('You plan a trip')) return user.startsWith('แผนส่วนนี้มีบรรทัด') ? PLAN_FIXED : PLAN;
  if (sys.startsWith('You are taking a quiz')) { // answers A, except question 2 of the first batch
    const n = (user.match(/^\d+\./gm) ?? []).length;
    return Array.from({ length: n }, (_, i) => `${i + 1}: ${i === 1 && quizRound === 1 ? 'C' : 'A'}`).join('\n');
  }
  if (sys.startsWith('You write multiple-choice quiz questions')) {
    quizRound++;
    const n = Number(sys.match(/Write exactly (\d+)/)[1]);
    return Array.from({ length: n }, (_, i) => {
      const [zh, th] = NUMBERS[((quizRound - 1) * 5 + i) % NUMBERS.length], others = NUMBERS.filter(([z]) => z !== zh).slice(0, 3).map(([, t]) => t);
      return `ข้อ ${i + 1}: ตัวเลข "${zh}" แปลว่าอะไร\nA) ${th}\nB) ${others[0]}\nC) ${others[1]}\nD) ${others[2]}\nตอบ: A\nอธิบาย: ${zh} คือ${th}`;
    }).join('\n\n');
  }
  return 'ok';
}

test('trip requests: place, length, budget, people, month; questions and invitations are not plans', () => {
  assert.deepEqual(tripAsk('วางแผนเที่ยวเชียงใหม่ 3 วัน 2 คืน งบ 10000 บาท'), { destination: 'เชียงใหม่', days: 3, nights: 2, daysGuessed: false, daysAsked: null, budget: 10000, perPerson: false, people: null, when: null, style: [], from: null });
  const osaka = tripAsk('ช่วยวางแผนไปเที่ยวญี่ปุ่นโอซาก้า 5 วัน ช่วงเดือนธันวา งบคนละ 40,000');
  assert.equal(osaka.destination, 'ญี่ปุ่นโอซาก้า'); assert.equal(osaka.days, 5); assert.equal(osaka.budget, 40000); assert.equal(osaka.perPerson, true); assert.equal(osaka.when, 'ธันวาคม');
  assert.equal(tripAsk('วางแผนเที่ยวไต้หวัน 5 วัน').destination, 'ไต้หวัน', '"วัน" inside a name does not cut it');
  assert.equal(tripAsk('วางแผนเที่ยวญี่ปุ่นตอนเหนือ 6 วัน').destination, 'ญี่ปุ่นตอนเหนือ');
  assert.deepEqual([tripAsk('แพลนทริปเกาหลี 4D3N ให้หน่อย').days, tripAsk('แพลนทริปเกาหลี 4D3N ให้หน่อย').nights], [4, 3]);
  assert.equal(tripAsk('อยากไปเที่ยวน่าน ช่วยวางแผนให้หน่อย').destination, 'น่าน');
  const kan = tripAsk('ขอแผนเที่ยวกาญจนบุรี วันเดียว ขับรถไปจากกรุงเทพ');
  assert.deepEqual([kan.destination, kan.days, kan.nights, kan.from], ['กาญจนบุรี', 1, 0, 'กรุงเทพ']);
  const khao = tripAsk('วางแผนเที่ยวเขาใหญ่ 2 วัน 1 คืน ไป 4 คน งบ 2 หมื่น');
  assert.deepEqual([khao.people, khao.budget], [4, 20000]);
  assert.deepEqual([tripAsk('วางแผนท่องเที่ยวสิงคโปร์ 3 วัน งบ 15k').budget, tripAsk('จัดทริปเที่ยวทะเลกับแฟน 2 วัน 1 คืน').people], [15000, 2]);
  assert.equal(tripAsk('วางแผนเที่ยวหลวงพระบาง ๓ วัน ๒ คืน').days, 3, 'Thai digits');
  assert.deepEqual([tripAsk('ช่วยวางแผนเที่ยวเชียงรายได้ไหม').destination, tripAsk('ช่วยวางแผนเที่ยวเชียงรายได้ไหม').daysGuessed], ['เชียงราย', true]);
  assert.deepEqual([tripAsk('วางแผนเที่ยวญี่ปุ่น 14 วัน').days, tripAsk('วางแผนเที่ยวญี่ปุ่น 14 วัน').daysAsked], [10, 14]);
  assert.deepEqual(tripAsk('ทำแผนเที่ยวภูเก็ต สุดสัปดาห์นี้ สายกิน คาเฟ่').style, ['เน้นของกิน', 'คาเฟ่']);
  assert.equal(tripAsk('plan a 3-day trip to Chiang Mai').destination, 'Chiang Mai');
  assert.deepEqual(tripAsk('วางแผนเที่ยว 3 วัน งบ 5000'), { missing: 'destination' });
  const temples = tripAsk('จัดทริปให้พ่อแม่ไปทำบุญ 9 วัด กรุงเทพ 1 วัน');
  assert.deepEqual([temples.destination, temples.days, temples.style], ['กรุงเทพ', 1, ['ไหว้พระ', 'ครอบครัว']], 'a known place anywhere in the message');
  assert.equal(tripAsk('อยากได้ itinerary ญี่ปุ่น').destination, 'ญี่ปุ่น');
  assert.equal(tripQueries(tripAsk('plan a 3-day trip to Tokyo'))[0], 'ที่เที่ยว Tokyo ยอดนิยม');
  for (const t of ['วางแผนเที่ยวไหนดี', 'วางแผนเที่ยวยังไงให้ประหยัด', 'จัดทริปไปทะเลกันไหม', 'ทริปที่แล้วสนุกมาก', 'วางแผนการเงินให้หน่อย', 'จัดโต๊ะทำงานยังไงดี',
    'แนะนำที่เที่ยวเชียงใหม่หน่อย', 'เที่ยวญี่ปุ่นช่วงไหนดี', 'งานวางแผนเที่ยวถึงไหนแล้ว']) assert.equal(tripAsk(t), null, t);
  assert.deepEqual(tripQueries(tripAsk('วางแผนเที่ยวเชียงใหม่ 3 วัน 2 คืน')), ['ที่เที่ยวเชียงใหม่ ยอดนิยม', 'เที่ยวเชียงใหม่ 3 วัน 2 คืน', 'ร้านอาหารเชียงใหม่ แนะนำ', 'ค่าใช้จ่าย เที่ยวเชียงใหม่ ราคา']);
  assert.deepEqual(dayChunks(7).map((c) => [c.from, c.to, c.first, c.last]), [[1, 4, true, false], [5, 7, false, true]]);
  assert.deepEqual(dayChunks(10).map((c) => [c.from, c.to]), [[1, 4], [5, 8], [9, 10]]);
});

test('quiz requests: making one, not taking one', () => {
  assert.deepEqual(quizAsk('ทำแบบทดสอบภาษาจีนแบบมีคำตอบ ABCD'), { subject: 'ภาษาจีน', lang: 'zh', level: null, topic: null, count: 10 });
  assert.deepEqual(quizAsk('ทำแบบทดสอบภาษาจีน HSK 2 20 ข้อ'), { subject: 'ภาษาจีน', lang: 'zh', level: 'HSK 2', topic: null, count: 20 });
  assert.deepEqual(quizAsk('ออกข้อสอบวิทยาศาสตร์ ม.2 เรื่องเซลล์ 10 ข้อ ABCD'), { subject: 'วิทยาศาสตร์', lang: null, level: 'ม.2', topic: 'เซลล์', count: 10 });
  assert.equal(quizAsk('ช่วยทำควิซประวัติศาสตร์ไทยให้หน่อย').subject, 'ประวัติศาสตร์ไทย');
  assert.deepEqual([quizAsk('สร้างแบบทดสอบภาษาญี่ปุ่น JLPT N5 เรื่องคำช่วย').level, quizAsk('สร้างแบบทดสอบภาษาญี่ปุ่น JLPT N5 เรื่องคำช่วย').topic], ['JLPT N5', 'คำช่วย']);
  assert.equal(quizAsk('ช่วยออกข้อสอบภาษาจีนให้ลูกหน่อย 50 ข้อ').count, 30, 'at most 30');
  for (const t of ['พรุ่งนี้ต้องไปทำข้อสอบ', 'เมื่อวานทำข้อสอบไม่ทัน', 'ทำข้อสอบเสร็จแล้ว', 'ทำแบบทดสอบบุคลิกภาพให้หน่อย', 'ขอข้อสอบเก่า', 'ทำโจทย์คณิต', 'ทำแบบทดสอบจากไฟล์นี้'])
    assert.equal(quizAsk(t), null, t);
});

test('sales requests: products and prices from the message', () => {
  assert.deepEqual(salesAsk('ทำเอ็กเซลการขายสินค้า'), { shop: null, products: [] });
  assert.deepEqual(salesAsk('ทำ excel ยอดขายร้านกาแฟ มีลาเต้ 55 บาท อเมริกาโน่ 45 บาท ชาเขียว 50 บาท'), { shop: 'ร้านกาแฟ', products: [
    { name: 'ลาเต้', price: 55, unit: '', cost: null }, { name: 'อเมริกาโน่', price: 45, unit: '', cost: null }, { name: 'ชาเขียว', price: 50, unit: '', cost: null }] });
  assert.deepEqual(productsIn('ทำตารางบันทึกยอดขาย สินค้า: เสื้อยืด 250, กางเกง 390, หมวก 150').map((p) => [p.name, p.price]), [['เสื้อยืด', 250], ['กางเกง', 390], ['หมวก', 150]]);
  assert.deepEqual(productsIn('ทำ excel ขายของให้หน่อย\n- สบู่ 35 บาท ต้นทุน 20\n- แชมพู 89 บาท ต้นทุน 50\n- ยาสีฟัน 45').map((p) => [p.name, p.price, p.cost]), [['สบู่', 35, 20], ['แชมพู', 89, 50], ['ยาสีฟัน', 45, null]]);
  const may = salesAsk('ช่วยทำไฟล์เอ็กเซลไว้จดยอดขายร้านน้องเมย์หน่อย ขายขนมครก ราคา 30 บาท/กล่อง กับ ขนมชั้น 25 บาท');
  assert.equal(may.shop, 'ร้านน้องเมย์');
  assert.deepEqual(may.products.map((p) => [p.name, p.price, p.unit]), [['ขนมครก', 30, 'กล่อง'], ['ขนมชั้น', 25, '']]);
  assert.deepEqual(productsIn('ทำ excel ยอดขาย ลาเต้55บาท มอคค่า60บาท').map((p) => p.name), ['ลาเต้', 'มอคค่า']);
  for (const t of ['excel ใช้ยังไง', 'ยอดขายเดือนนี้เท่าไหร่', 'ทำตารางเวลาเรียน', 'ทำ excel สรุปยอดขายจากไฟล์นี้']) assert.equal(salesAsk(t), null, t);
  assert.equal(salesFileName({ shop: 'ร้าน/กาแฟ:ดี' }, '2026-10-25'), 'spreadsheets/2026-10-25-ยอดขาย-ร้าน-กาแฟ-ดี.xlsx');
  assert.equal(fileSlug('แผนเที่ยวเชียงใหม่ 3 วัน 2 คืน'), 'แผนเที่ยวเชียงใหม่-3-วัน-2-คืน');
});

test('the new requests leave research, update, brief and schedule phrases alone', () => {
  for (const t of ['ค้นเรื่องเที่ยวญี่ปุ่นแล้วเก็บเข้าคลัง', 'อัปเดตเรื่อง ROCm 10 ในคลัง', 'สรุปข่าว AI ให้หน่อย', 'ทุกเช้า 7 โมง สรุปข่าว AI ให้หน่อย', 'ดูงานที่ตั้งเวลาไว้'])
    for (const parse of [tripAsk, quizAsk, salesAsk]) assert.equal(parse(t), null, `${parse.name}: ${t}`);
  for (const t of ['วางแผนเที่ยวเชียงใหม่ 3 วัน', 'ทำแบบทดสอบภาษาจีน 10 ข้อ', 'ทำ excel ยอดขาย']) {
    assert.equal(researchTopic(t), null, t); assert.equal(updateTopic(t), null, t); assert.equal(briefTopic(t), null, t);
  }
});

test('trip plan: every line checked against the source it cites, one revision, no totals', async () => {
  const req = tripAsk('วางแผนเที่ยวเชียงใหม่ 3 วัน 2 คืน งบ 10000 บาท');
  const asks = [];
  const r = await runTrip({ req, search: webSearch, today: '25 ตุลาคม 2569', ask: async (messages, params) => { asks.push({ messages, params }); return modelFor(messages); } });
  assert.equal(r.status, 'ready');
  assert.equal(asks.length, 2, 'a plan and one revision');
  assert.match(asks[0].messages[0].content, /using ONLY the places, food and prices found in the numbered sources/);
  assert.match(asks[0].messages[1].content, /^ปลายทาง: เชียงใหม่\nทั้งทริป: 3 วัน 2 คืน\nงบ: 10,000 บาท ทั้งทริป\nเขียนเฉพาะ: วันที่ 1 ถึง 3 \+ งบประมาณ \+ เคล็ดลับ/);
  assert.match(asks[1].messages[1].content, /"กลางวัน: ร้านลับแลคาเฟ่ดอย \[2\]": ชื่อสถานที่ไม่มีในแหล่ง \[2\]/);
  assert.match(asks[1].messages[1].content, /"บ่าย: ม่อนแจ่ม ค่ายานพาหนะ 25 บาท \[5\]": ตัวเลข 25 ไม่มีในแหล่ง \[5\]/);
  assert.deepEqual(r.sources.map((s) => s.url), ['https://a.example/1', 'https://b.example/1', 'https://c.example/1', 'https://d.example/1', 'https://a.example/2']);
  assert.equal(r.plan.days.length, 3);
  assert.deepEqual(r.plan.days[1].items.map((i) => i.text), ['ดอยอินทนนท์ ค่าเข้า 50 บาท', 'เวลาอิสระ', 'ม่อนแจ่ม ค่ายานพาหนะ 20 บาท', 'พักผ่อนที่ที่พัก']);
  assert.deepEqual(r.removed, [{ line: 'รวมทั้งหมดประมาณ 8,000 บาท', problems: ['ราคาไม่มีเลขแหล่ง [n]'] }], 'a total the model made up is dropped');
  assert.deepEqual(r.plan.budget.map((i) => i.text), ['ตั๋วเครื่องบินไปกลับ: เริ่มต้น 1,500 บาท', 'ที่พักในเมือง: คืนละ 800-1,200 บาท']);
  assert.equal(r.checked, 10);
  const text = tripReport(req, r, 'documents/trips/x.docx');
  assert.match(text, /^แผนเที่ยวเชียงใหม่ 3 วัน 2 คืน เสร็จแล้ว\nไฟล์ Word: documents\/trips\/x\.docx\nเที่ยวเชียงใหม่ 3 วัน/);
  assert.match(text, /\nวันที่ 2: ดอยอินทนนท์\n• เช้า: ดอยอินทนนท์ ค่าเข้า 50 บาท \[2\]\n• กลางวัน: เวลาอิสระ\n/);
  assert.match(text, /\(ตรวจชื่อสถานที่และตัวเลขกับแหล่งแล้ว 10 รายการ จาก 5 แหล่ง · ตัดออก 1 บรรทัดที่ตรวจไม่ผ่าน\)$/);
  // the Excel: a sheet per day, prices as numbers, totals by formula from one people cell
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await tripXlsx(req, r, '25 ตุลาคม 2569'));
  assert.deepEqual(wb.worksheets.map((s) => s.name), ['สรุป', 'วันที่ 1', 'วันที่ 2', 'วันที่ 3', 'ราคาจากแหล่ง', 'แหล่งข้อมูล']);
  const d1 = wb.getWorksheet('วันที่ 1');
  assert.deepEqual([d1.getCell('B2').value, d1.getCell('E2').value, d1.getCell('F2').value, d1.getCell('D3').value], ['เช้า', 30, 'ต่อคน', 'อาหาร']);
  assert.match(d1.getCell('H2').formula, /^IF\(G2="","",G2\*'สรุป'!\$B\$3\)$/);
  assert.deepEqual([wb.getWorksheet('สรุป').getCell('B3').value, wb.getWorksheet('สรุป').getCell('B4').value], [2, 10000], 'people (2 when not told) and the budget');
  assert.deepEqual(priceOf('ที่พักในเมือง: คืนละ 800-1,200 บาท'), { price: 800, perGroup: true, from: true });
  assert.equal(priceOf('วัดเจดีย์หลวง'), null);
  // the pieces
  assert.equal(namedIn('ร้านลับแลคาเฟ่ดอย', 'ดอยอินทนนท์ ค่าเข้าอุทยาน'), false);
  assert.equal(namedIn('ช้อปปิ้ง', 'อะไรก็ได้'), true, 'nothing named, nothing to look for');
  assert.equal(namedIn('ไหว้พระที่ปาย', 'เมืองปายมีวัดสวย'), true, 'a short name counts when all of it is there');
  const plan = parsePlan('**วันที่ 4 - ทะเล**\n1. เช้า - หาดป่าตอง [1, 2]\n- ค่ำ: ข้าวต้ม 09:30 น. 99 บาท [1]\nวันที่ 5\n- บ่าย: เวลาอิสระ', 2);
  assert.deepEqual(plan.days.map((d) => [d.n, d.theme, d.items.map((i) => [i.slot, i.text, i.cites])]), [[4, 'ทะเล', [['เช้า', 'หาดป่าตอง', [1, 2]], ['ค่ำ', 'ข้าวต้ม 09:30 น. 99 บาท', [1]]]], [5, '', [['บ่าย', 'เวลาอิสระ', []]]]]);
  const rows = checkPlan(plan, [{ title: 'ภูเก็ต', text: 'หาดป่าตอง ข้าวต้ม 99 บาท' }, { title: 'x', text: 'y' }], allowedNumbers(req, Date.UTC(2026, 9, 25)));
  assert.deepEqual(rows.map((r) => r.problems), [[], [], []], 'clock times are not checked; free time needs no source');
  const kept = keepPlan({ ...plan, days: [{ n: 1, theme: 'a', items: plan.days[0].items }] }, [], { from: 4, to: 4, first: false, last: false });
  assert.deepEqual(kept.plan.days.map((d) => d.n), [4], 'a part that starts again at day 1 is renumbered');
});

test('quiz: well-formed questions only, the model answers again without the key, answers spread over A–D', async () => {
  const qs = parseQuestions('ข้อ 1: 你好 แปลว่า\nA) สวัสดี\nB) สวัสดี\nC) ลาก่อน\nD) ขอบคุณ\nตอบ: A\n\n2. 谢谢 แปลว่าอะไร\nก. ขอโทษ\nข. ขอบคุณ\nค. ไม่เป็นไร\nง. ลาก่อน\nเฉลย: ข\nอธิบาย: 谢谢 แปลว่าขอบคุณ\n\nข้อ 3: ไม่มีภาษาจีน\nA) 1\nB) 2\nC) 3\nD) 4\nตอบ: C');
  assert.deepEqual(qs.map((q) => checkQuestion(q, { lang: 'zh' })), [['ตัวเลือกซ้ำกัน'], [], ['ไม่มีตัวอักษรของภาษานั้นในข้อ']]);
  assert.equal(qs[1].answer, 1, 'Thai letters ก–ง');
  assert.deepEqual(checkQuestion({ q: 'ข้อใดถูก', options: ['ก', 'ข', 'ค', 'ถูกทุกข้อ'], answer: 3 }), ['มีตัวเลือกแบบ "ถูกทุกข้อ"']);
  assert.deepEqual(parseAnswers('1: B\n2. A\nข้อ 3 - ค\n4) D', 4), [1, 0, 2, 3]);
  const many = Array.from({ length: 8 }, (_, i) => ({ q: `q${i}`, options: ['w', 'x', 'y', 'z'], answer: 0, explain: i === 0 ? 'ข้อ A ถูก' : 'ok' }));
  const balanced = balanceAnswers(many, 3);
  assert.equal(letterSpread(balanced), 'A 2 · B 2 · C 2 · D 2');
  assert.ok(balanced.every((q) => q.options[q.answer] === 'w'), 'the right option moves with its letter');
  assert.ok(balanced.filter((q) => q.answer !== 0).every((q) => q.explain !== 'ข้อ A ถูก'), 'an explanation naming a moved letter is dropped');
  quizRound = 0;
  const steps = [];
  const r = await runQuiz({ req: quizAsk('ทำแบบทดสอบภาษาจีน HSK 1 8 ข้อ'), ask: async (m) => modelFor(m), onStep: (s) => steps.push(s.text), seed: 42 });
  assert.equal(r.status, 'ready');
  assert.deepEqual(steps, ['เขียนข้อ 1–5 จาก 8', 'ตรวจคำตอบ 5 ข้อ', 'เขียนข้อ 5–8 จาก 8', 'ตรวจคำตอบ 4 ข้อ']);
  assert.equal(r.questions.length, 8);
  assert.deepEqual(r.dropped.map((d) => d.problems), [['ตอบซ้ำได้ C ไม่ตรงเฉลย A']]);
  assert.equal(letterSpread(r.questions), 'A 2 · B 2 · C 2 · D 2');
  const text = quizReport(quizAsk('ทำแบบทดสอบภาษาจีน HSK 1 8 ข้อ'), r, ['documents/quizzes/a.docx', 'documents/quizzes/a.xlsx']);
  assert.match(text, /^แบบทดสอบภาษาจีน HSK 1 เสร็จแล้ว: 8 ข้อ\nไฟล์ Word \(ข้อสอบ แล้วเฉลยแยกหน้าสุดท้าย\): documents\/quizzes\/a\.docx\nไฟล์ Excel/);
  assert.match(text, /ตัดข้อที่ไม่ผ่านไป 1 ข้อ/);
  assert.doesNotMatch(text, /ตอบ:|เฉลย: [A-D]/, 'the chat shows no answers');
  assert.equal((await runQuiz({ req: quizAsk('ทำแบบทดสอบภาษาจีน 5 ข้อ'), ask: async () => 'ขอโทษ ทำไม่ได้' })).status, 'not-enough');
});

test('sales workbook: formulas for every row, results filled in for the example rows, a product list to pick from', async () => {
  const buf = await salesWorkbook({ shop: 'ร้านกาแฟ', products: productsIn('ทำ excel ขายของ\n- ลาเต้ 55 บาท ต้นทุน 20\n- มอคค่า 60 บาท'), now: Date.UTC(2026, 9, 25, 3) });
  const zip = await (await import('jszip')).default.loadAsync(buf);
  assert.match(await zip.file('xl/workbook.xml').async('string'), /<calcPr [^>]*fullCalcOnLoad="1"/, 'Excel recalculates when the file opens');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['บันทึกการขาย', 'สินค้า', 'สรุป']);
  const log = wb.getWorksheet('บันทึกการขาย'), items = wb.getWorksheet('สินค้า'), sum = wb.getWorksheet('สรุป');
  assert.deepEqual([items.getCell('B2').value, items.getCell('C2').value, items.getCell('D2').value, items.getCell('B3').value], ['ลาเต้', 55, 20, 'มอคค่า']);
  assert.equal(log.getCell('B2').value, 'ลาเต้');
  assert.match(log.getCell('D2').formula, /^IF\(B2="","",IFERROR\(VLOOKUP\(B2,'สินค้า'!\$B:\$C,2,FALSE\)/);
  assert.deepEqual([log.getCell('D2').result, log.getCell('E2').result, log.getCell('G2').result, log.getCell('H2').result, log.getCell('I2').result], [55, 110, 110, 40, 70]);
  assert.ok(!log.getCell('I3').result, 'no cost, no profit');
  assert.ok(log.getCell('E501').formula, 'formulas ready in empty rows');
  assert.equal(log.getCell('B10').dataValidation.type, 'list');
  assert.deepEqual([...(await zip.file('xl/worksheets/sheet1.xml').async('string')).matchAll(/sqref="([^"]+)"/g)].map((m) => m[1]), ['B2:B501', 'C2:C501', 'J2:J501'], 'one rule per column: overlapping ranges make Excel report the file as damaged');
  assert.equal(sum.getCell('A1').value, 'สรุปยอดขาย ร้านกาแฟ');
  assert.deepEqual([sum.getCell('B3').result, sum.getCell('B4').result, sum.getCell('B5').result], [170, 3, 70]);
  assert.match(sum.getCell('C10').formula, /^IF\(A10="","",SUMIF\('บันทึกการขาย'!\$B\$2:\$B\$501,A10,'บันทึกการขาย'!\$G\$2:\$G\$501\)\)$/);
  assert.equal(sum.getCell('A72').value, 'ตุลาคม 2569');
  assert.equal(sum.getCell('C72').result, 170);
});

/** The server chat path with a fake model and web and a real workspace: ChatService + AgentService as service.mjs wires them. */
async function world(t, { webReady = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumicos-files-'));
  const store = new ConversationStore(path.join(dir, 'conversations.json'));
  const models = { turns: new Map(), enqueueChat: ModelService.prototype.enqueueChat, enqueueBackground: ModelService.prototype.enqueueBackground,
    async begin() { if (this.turns.size) throw new Error('โมเดลกำลังเปลี่ยนหรือมีงานตอบอยู่'); const id = randomUUID(); this.turns.set(id, {}); return { id, profile: { ctx: 8192, capabilities: { tools: false }, generation: { maxTokens: 100 } } }; },
    touch() {}, async end(id) { this.turns.delete(id); } };
  const config = { port: 0, allowedOrigins: [], internalToken: randomUUID(), dataDir: path.join(dir, 'data') };
  fs.mkdirSync(config.dataDir);
  const chats = new ChatService({ store, models, config, tools: { definitions: () => [] } });
  const service = { memory: { retrieve: async () => [], candidates: async () => [], dedupe: async (c) => c }, tools: { list: async () => [] } };
  chats.runtime = async () => ({ ...runtime, createServiceClient: () => service, LlamaCppProvider: class {
    async streamChat(request, cb) { cb.onToken(request.purpose === 'agent' ? modelFor(request.messages) : 'ok'); cb.onDone({ stopped: false }); } } });
  const files = new FileService(new Workspace(path.join(dir, 'workspace')), path.join(dir, 'backups'));
  const web = { ready: webReady };
  const agent = new AgentService({ store, models, config, files, runtime: () => chats.runtime(),
    webGateway: { search: async (input) => ({ results: await webSearch(input.query) }) }, webStatus: async () => ({ ready: web.ready }) });
  agent.pollMs = 5; agent.retryMs = 5;
  agent.now = () => Date.UTC(2026, 9, 25, 3);
  chats.agent = agent; models.yieldBackground = () => agent.yieldNow();
  t.after(async () => { chats.close(); await agent.tail; await models.chatTail; await store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  async function send(text, { extra = {}, settings = {}, parts = [], private: isPrivate = false } = {}) {
    const id = randomUUID();
    await store.transaction({ revision: store.state.revision, upsert: [{ id, title: 't', characterId: runtime.DEFAULT_CHARACTER.id, messages: [], ...extra }] });
    if (isPrivate) store.state.conversations.find((c) => c.id === id).private = true; // as agentJobs does: the store refuses private chats
    const job = await chats.submit({ requestId: randomUUID(), conversationId: id, user: { id: randomUUID(), role: 'user', parts: [{ type: 'text', text }, ...parts] }, settings });
    await until(() => !['queued', 'running'].includes(store.state.jobs.find((j) => j.id === job.id).status), `the chat job for "${text}"`);
    const reply = () => store.conversation(id).messages.find((m) => m.id === job.replyId);
    return { id, reply, text: () => reply().parts.filter((p) => p.type === 'text').map((p) => p.text).join(''), chips: () => reply().parts.filter((p) => p.type === 'attachment') };
  }
  const ws = (rel) => path.join(dir, 'workspace', ...rel.split('/'));
  const log = () => fs.readFileSync(path.join(config.dataDir, 'logs', 'tool-decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { store, agent, send, ws, web, log };
}

test('chat: "วางแผนเที่ยว…" answers at once, then the plan, a Word file in documents/trips and its chip', async (t) => {
  const w = await world(t);
  const r = await w.send('วางแผนเที่ยวเชียงใหม่ 3 วัน 2 คืน งบ 10000 บาท');
  assert.match(r.text(), /^รับงานวางแผนเที่ยวแล้ว: “เชียงใหม่ 3 วัน 2 คืน”\nจะค้นที่เที่ยว ร้านอาหาร และราคาจากเว็บหลายแหล่ง|^งานวางแผนเที่ยว: “เชียงใหม่ 3 วัน 2 คืน”/);
  await w.agent.tail;
  const text = r.text();
  assert.match(text, /^แผนเที่ยวเชียงใหม่ 3 วัน 2 คืน เสร็จแล้ว\nไฟล์ Word: documents\/trips\/2026-10-25-แผนเที่ยวเชียงใหม่-3-วัน-2-คืน\.docx\nไฟล์ Excel \(ชีตละวัน ยอดรวมคำนวณให้ แก้จำนวนคนได้\): documents\/trips\/2026-10-25-แผนเที่ยวเชียงใหม่-3-วัน-2-คืน\.xlsx\n/);
  const [chip, sheetChip] = r.chips();
  assert.equal(sheetChip.importedPath, 'documents/trips/2026-10-25-แผนเที่ยวเชียงใหม่-3-วัน-2-คืน.xlsx');
  assert.ok(fs.existsSync(w.ws(sheetChip.importedPath)));
  assert.deepEqual([chip.name, chip.kind, chip.importedPath, chip.agentOutput], ['2026-10-25-แผนเที่ยวเชียงใหม่-3-วัน-2-คืน.docx', 'docx', 'documents/trips/2026-10-25-แผนเที่ยวเชียงใหม่-3-วัน-2-คืน.docx', true]);
  const docx = fs.readFileSync(w.ws(chip.importedPath));
  assert.equal(docx.subarray(0, 2).toString(), 'PK', 'a real .docx (zip)');
  assert.equal(chip.size, docx.length);
  assert.equal(r.reply().citations.length, 5);
  const again = await w.send('วางแผนเที่ยวเชียงใหม่ 3 วัน 2 คืน งบ 10000 บาท');
  await w.agent.tail;
  assert.match(again.text(), /ไฟล์ Word: documents\/trips\/2026-10-25-แผนเที่ยวเชียงใหม่-3-วัน-2-คืน \(2\)\.docx/, 'a second plan never overwrites the first');
  const status = await w.send('งานวางแผนเที่ยวถึงไหนแล้ว');
  assert.match(status.text(), /^ตอนนี้ไม่มีงานค้างอยู่\n\nงานล่าสุด:\n• วางแผนเที่ยว “เชียงใหม่ 3 วัน 2 คืน” → ไฟล์ Word \+ Excel — เสร็จ \(documents\/trips\/2026-10-25-แผนเที่ยวเชียงใหม่-3-วัน-2-คืน \(2\)\.docx\)/);
  assert.deepEqual(w.log().filter((l) => l.route === 'AGENT').map((l) => l.reason), ['trip', 'trip', 'status']);
  assert.equal(labelOf({ kind: 'quiz', topic: 'แบบทดสอบภาษาจีน' }), 'ทำ “แบบทดสอบภาษาจีน” → ไฟล์ Word + Excel');
});

test('chat: trip refusals and a missing place', async (t) => {
  const w = await world(t, { webReady: false });
  assert.match((await w.send('วางแผนเที่ยวเชียงใหม่ 3 วัน')).text(), /^ตอนนี้ระบบค้นเว็บยังไม่พร้อม เลยเริ่มวางแผนเที่ยว “เชียงใหม่ 3 วัน 2 คืน” ไม่ได้/);
  w.web.ready = true;
  assert.match((await w.send('วางแผนเที่ยวเชียงใหม่ 3 วัน', { settings: { knowledge: { searchMode: 'OFF' } } })).text(), /^ตอนนี้ตั้งค่าปิดการค้นเว็บอยู่ เลยวางแผนเที่ยว “เชียงใหม่ 3 วัน 2 คืน” ไม่ได้/);
  assert.match((await w.send('วางแผนเที่ยว 3 วัน งบ 5000')).text(), /^จะไปเที่ยวที่ไหนดี บอกปลายทางมาพร้อมจำนวนวันได้เลย/);
  assert.equal((await w.send('ยกเลิกงานวางแผนเที่ยว')).text(), 'ok', 'nothing running: an ordinary chat turn, not a new plan');
  assert.equal((await w.send('แนะนำที่เที่ยวเชียงใหม่หน่อย')).text(), 'ok', 'a question goes to the chat');
  assert.equal(w.agent.list().length, 0);
});

test('chat: a quiz becomes a Word file with the key on its own page and an Excel sheet', async (t) => {
  const w = await world(t);
  quizRound = 0;
  const r = await w.send('ทำแบบทดสอบภาษาจีน HSK 1 6 ข้อ');
  assert.match(r.text(), /^รับงานทำแบบทดสอบแล้ว: “แบบทดสอบภาษาจีน HSK 1” 6 ข้อ\n|^งานทำแบบทดสอบ: “แบบทดสอบภาษาจีน HSK 1”/);
  await w.agent.tail;
  assert.match(r.text(), /^แบบทดสอบภาษาจีน HSK 1 เสร็จแล้ว: 6 ข้อ\nไฟล์ Word \(ข้อสอบ แล้วเฉลยแยกหน้าสุดท้าย\): documents\/quizzes\/2026-10-25-แบบทดสอบภาษาจีน-HSK-1\.docx\nไฟล์ Excel \(คำถาม ตัวเลือก เฉลย คำอธิบาย\): documents\/quizzes\/2026-10-25-แบบทดสอบภาษาจีน-HSK-1\.xlsx\n/);
  assert.deepEqual(r.chips().map((c) => c.kind), ['docx', 'xlsx']);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(w.ws(r.chips()[1].importedPath));
  const sheet = wb.getWorksheet('แบบทดสอบ');
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['ข้อ', 'คำถาม', 'A', 'B', 'C', 'D', 'คำตอบ', 'คำอธิบาย']);
  assert.equal(sheet.rowCount, 7);
  const answers = Array.from({ length: 6 }, (_, i) => sheet.getRow(i + 2).getCell(7).value);
  assert.ok(new Set(answers).size >= 3, `answers spread: ${answers}`);
  assert.equal(w.agent.list()[0].result.questions, 6);
  assert.match((await w.send('ทำแบบทดสอบภาษาจีน 10 ข้อ', { private: true })).text(), /^แชตส่วนตัวไม่รับงานทำแบบทดสอบ/);
});

test('chat: "ทำ excel ยอดขาย…" makes the workbook at once, no model and no queue', async (t) => {
  const w = await world(t);
  const r = await w.send('ทำ excel ยอดขายร้านกาแฟ มีลาเต้ 55 บาท อเมริกาโน่ 45 บาท');
  assert.match(r.text(), /^ทำไฟล์ Excel บันทึกยอดขาย ร้านกาแฟ แล้ว\nไฟล์: spreadsheets\/2026-10-25-ยอดขาย-ร้านกาแฟ\.xlsx\n/);
  assert.match(r.text(), /ใส่ให้แล้ว 2 รายการ \(ลาเต้ 55 บาท, อเมริกาโน่ 45 บาท\)/);
  const [chip] = r.chips();
  assert.equal(chip.importedPath, 'spreadsheets/2026-10-25-ยอดขาย-ร้านกาแฟ.xlsx');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(w.ws(chip.importedPath));
  assert.equal(wb.getWorksheet('สินค้า').getCell('B3').value, 'อเมริกาโน่');
  assert.equal(w.agent.list().length, 0, 'not a background job');
  const withFile = await w.send('ทำ excel ยอดขายจากไฟล์นี้', { parts: [{ type: 'attachment', id: randomUUID(), name: 'a.csv', size: 3, kind: 'csv', context: 'a,b', complete: true, totalChunks: 1 }] });
  assert.equal(withFile.text(), 'ok', 'a file attached goes to the chat');
  assert.deepEqual(w.log().filter((l) => l.route === 'AGENT').map((l) => l.reason), ['sales']);
});

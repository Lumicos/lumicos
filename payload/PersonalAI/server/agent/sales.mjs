// A sales workbook (claude-20261025, user: "ทำเอ็กเซลการขายสินค้า"): "ทำ excel ยอดขายร้านกาแฟ มีลาเต้ 55 บาท อเมริกาโน่ 45 บาท".
// No model: products and prices are read from the message (example rows when there are none), and the sheets calculate
// with formulas, so the file keeps working as the user adds sales. Sheets: บันทึกการขาย (a sale per row: pick the product
// from a list and the price, total, net and profit fill in), สินค้า (products, prices, costs), สรุป (totals, per product,
// per month). Formula results are filled in for the example rows so previews show numbers; Excel recalculates on open.
import ExcelJS from 'exceljs';
import { fileSlug } from './outputs.mjs';

export const LOG_ROWS = 500; // pre-made rows in บันทึกการขาย
export const PRODUCT_ROWS = 200;
const SUMMARY_PRODUCTS = 50;
const arabic = (s) => String(s ?? '').replace(/[๐-๙]/gu, (c) => String(c.charCodeAt(0) - 0x0e50));
const SHEET = String.raw`(?:ไฟล์\s*)?(?:เอ็กเซลล์?|เอ็กเซล|เอกเซลล์?|excel|xlsx|สเปรดชี[ตท]|spreadsheet|ชี[ตท]|sheet|ตาราง)`;
const SALE = String.raw`(?:ยอดขาย|การขาย|ขายสินค้า|ขายของ|ขาย|รายรับ|sales?)`;
const ASK = [
  new RegExp(`(?:ทำ|สร้าง|ขอ|จัดทำ|ออกแบบ|อยากได้|make|create)\\s*${SHEET}\\s*(?:สำหรับ|เอาไว้|ไว้|ใช้)?\\s*(?:บันทึก|จด|สรุป|คิด|เก็บ|ทำ)?\\s*${SALE}`, 'iu'),
  new RegExp(`(?:ทำ|สร้าง|ขอ|จัดทำ|อยากได้)\\s*(?:ตาราง|ไฟล์|ระบบ)?\\s*(?:บันทึก|จด|สรุป)\\s*(?:ยอดขาย|การขาย|รายรับ|รายการขาย)`, 'iu'),
  /\b(?:make|create)\s+(?:a|an|my)?\s*sales?\s+(?:spreadsheet|sheet|workbook|excel|tracker)/iu,
];
const PRICE = String.raw`(\d[\d,]*(?:\.\d{1,2})?)`;
const PRODUCT = new RegExp(`^(.{1,40}?)\\s*(?:ราคา|ขาย|ละ|[-–:=])?\\s*${PRICE}\\s*(?:บาท|฿|\\.-|baht)?(?:\\s*(?:\\/|ต่อ)\\s*([^\\s\\d,]{1,8}))?(?:\\s*(?:ต้นทุน|ทุน)\\s*${PRICE}\\s*(?:บาท|฿)?)?\\s*$`, 'iu');
const NOT_A_NAME = /ทำ|สร้าง|excel|เอ็กเซล|เอกเซล|ตาราง|ไฟล์|ชีต|ชีท|ยอดขาย|การขาย|ให้หน่อย|ต้นทุน|^(?:ราคา|ขาย|และ|กับ|มี)$/iu;

/** One product line: "ลาเต้ 55 บาท/แก้ว ต้นทุน 20" → {name, price, unit, cost}, or null. */
export function productOf(piece) {
  const m = String(piece ?? '').replace(/^[\s\-•*]+|[\s.]+$/gu, '').match(PRODUCT);
  if (!m) return null;
  const name = m[1].replace(/^(?:\d+[.)]\s*|มี|ได้แก่|คือ|และ|กับ|สินค้า|เมนู)\s*/u, '').replace(/[\s:：-]+$/u, '').trim();
  const price = Number(m[2].replace(/,/g, '')), cost = m[4] ? Number(m[4].replace(/,/g, '')) : null;
  if (!name || name.length > 30 || NOT_A_NAME.test(name) || !(price > 0 && price < 10_000_000)) return null;
  return { name, price, unit: m[3] ?? '', cost: cost > 0 ? cost : null };
}

const INLINE = /(\d[\d,]*(?:\.\d{1,2})?)\s*(?:บาท|฿|\.-|baht)(?:\s*(?:\/|ต่อ)\s*([^\s\d,]{1,8}))?(?:\s*(?:ต้นทุน|ทุน)\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:บาท|฿)?)?/giu;
const LEAD_IN = /(?:มี|ได้แก่|ประกอบด้วย|คือ|[:：]|ขาย(?!ดี)|หน่อย|ด้วย|เมนู|สินค้า|และ|กับ|[,，、;])/gu;
/** The name just before a price: the text after the last lead-in ("…ร้านกาแฟ มีลาเต้ 55 บาท" → "ลาเต้"). */
function nameBefore(segment) {
  let t = segment.replace(/\s*(?:ราคา|ขาย|ละ|[-–:=])\s*$/u, '');
  let cut = 0;
  for (const m of t.matchAll(LEAD_IN)) cut = m.index + m[0].length;
  t = t.slice(cut).trim();
  if (NOT_A_NAME.test(t) || t.length > 30) t = t.split(/\s+/u).pop() ?? '';
  return t.replace(/^(?:\d+[.)]\s*)/u, '').trim();
}

/** The products listed in the message: one per line, or inline ("มีลาเต้ 55 บาท อเมริกาโน่ 45 บาท", "สินค้า: เสื้อ 250, หมวก 150"). */
export function productsIn(text) {
  const t = arabic(text), found = [];
  const lines = t.split(/\r?\n/).slice(1).filter((l) => /\d/.test(l));
  if (lines.length) found.push(...lines.map(productOf));
  else {
    let last = 0;
    for (const m of t.matchAll(INLINE)) {
      const name = nameBefore(t.slice(last, m.index));
      last = m.index + m[0].length;
      const price = Number(m[1].replace(/,/g, '')), cost = m[3] ? Number(m[3].replace(/,/g, '')) : null;
      if (name && !NOT_A_NAME.test(name) && price > 0 && price < 10_000_000) found.push({ name, price, unit: m[2] ?? '', cost: cost > 0 ? cost : null });
    }
    if (!found.length) { // "สินค้า: เสื้อยืด 250, กางเกง 390" (no บาท): a list after a colon or "มี"
      const start = t.search(/(?:[:：]|มี|ได้แก่)\s*(?=[^\d]{1,40}\d)/u);
      if (start >= 0) found.push(...t.slice(start).replace(/^(?:[:：]|มี|ได้แก่)\s*/u, '').split(/[,，、;]|\s+(?:และ|กับ)\s*/u).map(productOf));
    }
  }
  const seen = new Set(), out = [];
  for (const p of found) if (p && !seen.has(p.name.toLowerCase())) { seen.add(p.name.toLowerCase()); out.push(p); }
  return out.slice(0, PRODUCT_ROWS);
}

/** {shop, products} of a "make me a sales sheet" request, or null. */
export function salesAsk(input) {
  const text = arabic(input).trim();
  const first = text.split(/\r?\n/)[0];
  if (!ASK.some((re) => re.test(first)) || /จาก\s*(?:ไฟล์|ข้อมูล|ตาราง)|ไฟล์\s*(?:นี้|ที่แนบ)|ที่แนบ/u.test(text)) return null;
  const shop = first.match(/(ร้าน(?:(?!มี|ให้|หน่อย|ด้วย|ขาย)[^\s,，:：]){1,30})/u)?.[1] ?? null;
  return { shop: shop && shop !== 'ร้าน' ? shop : null, products: productsIn(text) };
}

const EXAMPLES = [{ name: 'สินค้าตัวอย่าง 1', price: 100, unit: 'ชิ้น', cost: 60 }, { name: 'สินค้าตัวอย่าง 2', price: 250, unit: 'ชิ้น', cost: 150 }, { name: 'สินค้าตัวอย่าง 3', price: 59, unit: 'ชิ้น', cost: 25 }];
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const MONEY = '#,##0.00;[Red]-#,##0.00', COUNT = '#,##0', DATE = 'dd/mm/yyyy';
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
const INPUT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } };
const FONT = { name: 'Tahoma', size: 10 };
const LOG = "'บันทึกการขาย'", ITEMS = "'สินค้า'";
const utcDay = (y, m, d) => new Date(Date.UTC(y, m, d));

function header(ws, titles, widths) {
  ws.columns = titles.map((t, i) => ({ header: t, width: widths[i] }));
  const row = ws.getRow(1);
  row.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = HEAD_FILL; row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; row.height = 24;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

/**
 * The workbook (Buffer). now: the Bangkok day the example sales are dated. products: [{name, price, unit, cost}]
 * (example products when empty).
 */
export async function salesWorkbook({ shop = null, products = [], now = Date.now() } = {}) {
  const list = products.length ? products : EXAMPLES, examples = !products.length;
  const today = new Date(now + 7 * 3_600_000), y = today.getUTCFullYear(), mo = today.getUTCMonth(), d = today.getUTCDate();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Lumicos'; wb.created = new Date(now);
  wb.calcProperties = { fullCalcOnLoad: true };

  // ---- บันทึกการขาย: a sale per row -------------------------------------------------------------------------
  const log = wb.addWorksheet('บันทึกการขาย', { properties: { tabColor: { argb: 'FF2F5597' } } });
  header(log, ['วันที่', 'สินค้า', 'จำนวน', 'ราคาต่อหน่วย', 'ยอดขาย', 'ส่วนลด', 'ยอดสุทธิ', 'ต้นทุนรวม', 'กำไร', 'ช่องทาง', 'หมายเหตุ'], [12, 26, 9, 13, 13, 10, 13, 13, 13, 14, 26]);
  const sample = list.slice(0, 3).map((p, i) => ({ date: utcDay(y, mo, d), p, qty: [2, 1, 3][i], discount: 0, channel: ['หน้าร้าน', 'ออนไลน์', 'หน้าร้าน'][i] }));
  for (let r = 2; r <= LOG_ROWS + 1; r++) {
    const s = sample[r - 2], row = log.getRow(r);
    if (s) {
      row.getCell(1).value = s.date; row.getCell(2).value = s.p.name; row.getCell(3).value = s.qty; row.getCell(6).value = s.discount;
      row.getCell(10).value = s.channel; row.getCell(11).value = 'ตัวอย่าง ลบหรือแก้ได้';
    }
    const price = s ? s.p.price : '', total = s ? s.qty * s.p.price : '', net = s ? total - s.discount : '';
    const costTotal = s && s.p.cost != null ? s.qty * s.p.cost : '', profit = s && s.p.cost != null ? net - costTotal : '';
    row.getCell(4).value = { formula: `IF(B${r}="","",IFERROR(VLOOKUP(B${r},${ITEMS}!$B:$C,2,FALSE),"ไม่มีในรายการสินค้า"))`, result: price };
    row.getCell(5).value = { formula: `IF(OR(B${r}="",C${r}=""),"",IFERROR(C${r}*D${r},""))`, result: total };
    row.getCell(7).value = { formula: `IF(E${r}="","",E${r}-N(F${r}))`, result: net };
    row.getCell(8).value = { formula: `IF(OR(B${r}="",C${r}=""),"",IFERROR(IF(VLOOKUP(B${r},${ITEMS}!$B:$D,3,FALSE)="","",C${r}*VLOOKUP(B${r},${ITEMS}!$B:$D,3,FALSE)),""))`, result: costTotal };
    row.getCell(9).value = { formula: `IF(OR(G${r}="",H${r}=""),"",G${r}-H${r})`, result: profit };
    row.getCell(1).numFmt = DATE; row.getCell(3).numFmt = COUNT;
    for (const c of [4, 5, 6, 7, 8, 9]) row.getCell(c).numFmt = MONEY;
    for (const c of [1, 2, 3, 6, 10, 11]) row.getCell(c).fill = INPUT_FILL;
    row.font = FONT;
  }
  // one range per column (per-cell rules make ExcelJS write overlapping ranges, which Excel reports as damaged)
  const last = LOG_ROWS + 1;
  log.dataValidations.add(`B2:B${last}`, { type: 'list', allowBlank: true, formulae: [`${ITEMS}!$B$2:$B$${PRODUCT_ROWS + 1}`], showErrorMessage: true, errorStyle: 'warning', errorTitle: 'ไม่มีในรายการสินค้า', error: 'เพิ่มสินค้านี้ในชีต "สินค้า" ก่อน หรือเลือกจากรายการ' });
  log.dataValidations.add(`C2:C${last}`, { type: 'decimal', operator: 'greaterThan', allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: 'จำนวนไม่ถูกต้อง', error: 'ใส่จำนวนมากกว่า 0' });
  log.dataValidations.add(`J2:J${last}`, { type: 'list', allowBlank: true, formulae: ['"หน้าร้าน,ออนไลน์,ส่งของ,อื่น ๆ"'] });
  log.autoFilter = { from: 'A1', to: 'K1' };

  // ---- สินค้า -------------------------------------------------------------------------------------------------
  const items = wb.addWorksheet('สินค้า', { properties: { tabColor: { argb: 'FF548235' } } });
  header(items, ['รหัส', 'สินค้า', 'ราคาขาย', 'ต้นทุนต่อหน่วย', 'หน่วย', 'หมวด', 'หมายเหตุ'], [9, 28, 12, 14, 9, 14, 30]);
  for (let r = 2; r <= PRODUCT_ROWS + 1; r++) {
    const p = list[r - 2], row = items.getRow(r);
    if (p) {
      row.getCell(1).value = `P${String(r - 1).padStart(3, '0')}`; row.getCell(2).value = p.name; row.getCell(3).value = p.price;
      if (p.cost != null) row.getCell(4).value = p.cost;
      row.getCell(5).value = p.unit || 'ชิ้น';
      if (examples) row.getCell(7).value = 'ตัวอย่าง แก้เป็นสินค้าจริงได้';
    }
    row.getCell(3).numFmt = MONEY; row.getCell(4).numFmt = MONEY; row.font = FONT;
    for (const c of [1, 2, 3, 4, 5, 6, 7]) row.getCell(c).fill = INPUT_FILL;
  }

  // ---- สรุป ---------------------------------------------------------------------------------------------------
  const sum = wb.addWorksheet('สรุป', { properties: { tabColor: { argb: 'FFBF8F00' } } });
  sum.columns = [{ width: 28 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 14 }];
  const L = LOG_ROWS + 1, sales = sample.map((s) => ({ ...s, net: s.qty * s.p.price - s.discount, profit: s.p.cost != null ? s.qty * (s.p.price - s.p.cost) - s.discount : null }));
  const totalNet = sales.reduce((a, s) => a + s.net, 0), totalQty = sales.reduce((a, s) => a + s.qty, 0), totalProfit = sales.reduce((a, s) => a + (s.profit ?? 0), 0);
  sum.getCell('A1').value = shop ? `สรุปยอดขาย ${shop}` : 'สรุปยอดขาย';
  sum.getCell('A1').font = { ...FONT, size: 14, bold: true };
  const kpi = [['ยอดขายสุทธิรวม (บาท)', `SUM(${LOG}!G2:G${L})`, totalNet, MONEY], ['จำนวนที่ขายรวม', `SUM(${LOG}!C2:C${L})`, totalQty, COUNT],
    ['กำไรรวม (บาท)', `SUM(${LOG}!I2:I${L})`, totalProfit, MONEY], ['จำนวนรายการขาย', `COUNTA(${LOG}!B2:B${L})`, sales.length, COUNT]];
  kpi.forEach(([label, formula, result, fmt], i) => {
    const r = 3 + i;
    sum.getCell(`A${r}`).value = label; sum.getCell(`A${r}`).font = { ...FONT, bold: true };
    sum.getCell(`B${r}`).value = { formula, result }; sum.getCell(`B${r}`).numFmt = fmt; sum.getCell(`B${r}`).font = { ...FONT, bold: true, size: 12 };
  });
  const top = 9;
  ['สินค้า', 'จำนวนที่ขาย', 'ยอดขายสุทธิ', 'กำไร', 'สัดส่วนยอดขาย'].forEach((t, i) => { const c = sum.getCell(top, i + 1); c.value = t; c.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD_FILL; c.alignment = { horizontal: 'center' }; });
  for (let i = 0; i < SUMMARY_PRODUCTS; i++) {
    const r = top + 1 + i, p = list[i], mine = sales.filter((s) => s.p === p);
    const qty = mine.reduce((a, s) => a + s.qty, 0), net = mine.reduce((a, s) => a + s.net, 0), profit = mine.reduce((a, s) => a + (s.profit ?? 0), 0);
    sum.getCell(`A${r}`).value = { formula: `IF(${ITEMS}!B${i + 2}="","",${ITEMS}!B${i + 2})`, result: p?.name ?? '' };
    sum.getCell(`B${r}`).value = { formula: `IF(A${r}="","",SUMIF(${LOG}!$B$2:$B$${L},A${r},${LOG}!$C$2:$C$${L}))`, result: p ? qty : '' };
    sum.getCell(`C${r}`).value = { formula: `IF(A${r}="","",SUMIF(${LOG}!$B$2:$B$${L},A${r},${LOG}!$G$2:$G$${L}))`, result: p ? net : '' };
    sum.getCell(`D${r}`).value = { formula: `IF(A${r}="","",SUMIF(${LOG}!$B$2:$B$${L},A${r},${LOG}!$I$2:$I$${L}))`, result: p ? profit : '' };
    sum.getCell(`E${r}`).value = { formula: `IF(OR(A${r}="",$B$3=0),"",C${r}/$B$3)`, result: p && totalNet ? net / totalNet : '' };
    sum.getCell(`B${r}`).numFmt = COUNT; sum.getCell(`C${r}`).numFmt = MONEY; sum.getCell(`D${r}`).numFmt = MONEY; sum.getCell(`E${r}`).numFmt = '0.0%';
    sum.getRow(r).font = FONT;
  }
  const mTop = top + SUMMARY_PRODUCTS + 3;
  sum.getCell(`A${mTop - 1}`).value = `ยอดขายรายเดือน ปี ${y + 543}`; sum.getCell(`A${mTop - 1}`).font = { ...FONT, bold: true, size: 12 };
  ['เดือน', 'ตั้งแต่วันที่', 'ยอดขายสุทธิ', 'กำไร', 'จำนวนที่ขาย'].forEach((t, i) => { const c = sum.getCell(mTop, i + 1); c.value = t; c.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD_FILL; c.alignment = { horizontal: 'center' }; });
  for (let m = 0; m < 12; m++) {
    const r = mTop + 1 + m, inMonth = sales.filter((s) => s.date.getUTCMonth() === m && s.date.getUTCFullYear() === y);
    const range = (col) => `SUMIFS(${LOG}!$${col}$2:$${col}$${L},${LOG}!$A$2:$A$${L},">="&B${r},${LOG}!$A$2:$A$${L},"<"&EDATE(B${r},1))`;
    sum.getCell(`A${r}`).value = `${THAI_MONTHS[m]} ${y + 543}`;
    sum.getCell(`B${r}`).value = utcDay(y, m, 1); sum.getCell(`B${r}`).numFmt = DATE;
    sum.getCell(`C${r}`).value = { formula: range('G'), result: inMonth.reduce((a, s) => a + s.net, 0) };
    sum.getCell(`D${r}`).value = { formula: range('I'), result: inMonth.reduce((a, s) => a + (s.profit ?? 0), 0) };
    sum.getCell(`E${r}`).value = { formula: range('C'), result: inMonth.reduce((a, s) => a + s.qty, 0) };
    sum.getCell(`C${r}`).numFmt = MONEY; sum.getCell(`D${r}`).numFmt = MONEY; sum.getCell(`E${r}`).numFmt = COUNT;
    sum.getRow(r).font = FONT;
  }
  sum.getCell(`A${mTop + 14}`).value = 'ช่องสีเหลืองในชีต "บันทึกการขาย" และ "สินค้า" คือช่องที่กรอกเอง ช่องอื่นคำนวณให้อัตโนมัติ · เปลี่ยนปีในคอลัมน์ "ตั้งแต่วันที่" ได้';
  sum.getCell(`A${mTop + 14}`).font = { ...FONT, italic: true, color: { argb: 'FF666666' } };
  wb.views = [{ activeTab: 0 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const salesFileName = (req, day) => `spreadsheets/${day}-ยอดขาย${req.shop ? `-${fileSlug(req.shop, 30)}` : ''}.xlsx`;

/** The chat text for a made workbook. */
export function salesReport(req, file) {
  const lines = [`ทำไฟล์ Excel บันทึกยอดขาย${req.shop ? ` ${req.shop}` : ''} แล้ว`, `ไฟล์: ${file}`,
    '• ชีต “บันทึกการขาย”: กรอกวันที่ เลือกสินค้าจากรายการ ใส่จำนวน แล้วราคา ยอดขาย ยอดสุทธิ และกำไรคำนวณให้เอง (เตรียมไว้ 500 แถว)',
    `• ชีต “สินค้า”: ${req.products.length ? `ใส่ให้แล้ว ${req.products.length} รายการ (${req.products.slice(0, 6).map((p) => `${p.name} ${p.price.toLocaleString('en-US')} บาท`).join(', ')}${req.products.length > 6 ? ', …' : ''})` : 'ใส่สินค้าตัวอย่างไว้ 3 รายการ แก้เป็นสินค้าจริงได้'} เพิ่มได้ถึง ${PRODUCT_ROWS} รายการ`,
    '• ชีต “สรุป”: ยอดขายรวม กำไรรวม ยอดต่อสินค้าพร้อมสัดส่วน และยอดรายเดือนทั้งปี',
    'มีตัวอย่างการขาย 3 แถวให้ดูวิธีกรอก ลบหรือแก้ได้'];
  if (req.products.some((p) => p.cost == null)) lines.push('ใส่ต้นทุนต่อหน่วยในชีต “สินค้า” แล้วช่องกำไรจะคำนวณให้');
  return lines.join('\n');
}

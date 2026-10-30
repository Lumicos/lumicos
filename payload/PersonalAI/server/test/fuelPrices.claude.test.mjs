// claude-20261024: "ค้นเว็บ ราคาน้ำมันดีเซลวันนี้" was answered with links only (Real Chat Check rounds 9 and 10): the web
// search read the price pages but picked their intro text. Pump prices now come from gasprice.kapook.com directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuelPriceAsk, parseKapookFuel, formatFuel, fetchFuelPrices, FUEL_URL } from '../web/fuelPrices.mjs';
import { SearchV6Service } from '../web/searchV6Service.mjs';

const PAGE = fs.readFileSync(new URL('./fixtures/kapook-gasprice-20261024.html', import.meta.url), 'utf8');
const page = (html = PAGE, ok = true) => async (url) => ({ ok, url, text: async () => html });

test('which questions are today\'s Thai pump prices', () => {
  for (const q of ['ค้นเว็บ ราคาน้ำมันดีเซลวันนี้', 'ราคาน้ำมันวันนี้', 'เติม E20 ลิตรละกี่บาท', 'เบนซินราคาเท่าไหร่ตอนนี้', 'ราคาน้ำมันปตท.วันนี้'])
    assert.equal(fuelPriceAsk(q), true, q);
  for (const q of ['ราคาน้ำมันพืชวันนี้', 'ดีเซลพรุ่งนี้ขึ้นราคาไหม', 'ราคาน้ำมันดิบ brent วันนี้', 'ราคาน้ำมันที่ญี่ปุ่นลิตรละเท่าไหร่',
    'ราคาทองวันนี้', 'ข่าวน้ำมันดีเซลล่าสุด', 'น้ำมันดีเซลคืออะไร'])
    assert.equal(fuelPriceAsk(q), false, q);
});

test('the kapook page gives every brand, item, unit and the update date', () => {
  const d = parseKapookFuel(PAGE);
  assert.equal(d.date, '24 ตุลาคม 2569');
  assert.equal(d.isoDate, '2026-10-24');
  assert.deepEqual(d.brands.map((b) => b.brand), ['ปตท.', 'บางจาก', 'เชลล์', 'คาลเท็กซ์', 'ไออาร์พีซี', 'พีที', 'ซัสโก้', 'เพียว', 'ซัสโก้ ดีลเลอร์']);
  assert.equal(d.brands.reduce((n, b) => n + b.items.length, 0), 59);
  assert.deepEqual(d.brands[0].items.find((it) => it.name === 'ดีเซล B7'), { name: 'ดีเซล B7', price: 43.54, unit: 'บาท/ลิตร' });
  assert.deepEqual(d.brands[0].items.at(-1), { name: 'แก๊ส NGV', price: 20, unit: 'บาท/กก.' });
  assert.ok(!JSON.stringify(d).includes('99.99'), 'text inside <script> is not read');
  assert.equal(parseKapookFuel('<html><body><h1>ปิดปรับปรุง</h1></body></html>'), null, 'another layout: no data');
});

test('the evidence lists only the asked fuel and brand, with prices', () => {
  const d = parseKapookFuel(PAGE);
  const diesel = formatFuel(d, 'ค้นเว็บ ราคาน้ำมันดีเซลวันนี้');
  assert.match(diesel, /อัปเดต 24 ตุลาคม 2569/);
  assert.match(diesel, /^ปตท\.: ดีเซลพรีเมียม 50\.05 · ดีเซล B7 43\.54 · ดีเซล B20 37\.19$/m);
  assert.match(diesel, /^เชลล์: เชลล์ วี-เพาเวอร์ ดีเซล 51\.84 · เชลล์ ฟิวเซฟ ดีเซล 43\.54 · เชลล์ ดีเซล B20 37\.19$/m);
  assert.ok(!/แก๊สโซฮอล์|เบนซิน/.test(diesel), 'no petrol lines for a diesel question');
  const shell = formatFuel(d, 'แก๊สโซฮอล์ 95 ที่เชลล์ลิตรละเท่าไหร่');
  assert.equal(shell.split('\n').length, 2);
  assert.match(shell, /^เชลล์: เชลล์ ฟิวเซฟ แก๊สโซฮอล์ 95 42\.54/m);
  const all = formatFuel(d, 'ราคาน้ำมันวันนี้');
  assert.equal(all.split('\n').length, 10, 'header + 9 brands');
  assert.match(all, /แก๊ส NGV 20\.00 บาท\/กก\./);
  assert.equal(formatFuel({ ...d, brands: [{ brand: 'ไออาร์พีซี', items: [{ name: 'ดีเซล B7', price: 43.54, unit: 'บาท/ลิตร' }] }] }, 'ราคา NGV วันนี้'), null, 'nothing for the asked fuel');
});

test('fetching: prices on success, null on any failure', async () => {
  const ok = await fetchFuelPrices('ราคาน้ำมันดีเซลวันนี้', { fetchImpl: page() });
  assert.equal(ok.isoDate, '2026-10-24');
  assert.match(ok.text, /ดีเซล B7 43\.54/);
  assert.equal(await fetchFuelPrices('ราคาน้ำมันดีเซลวันนี้', { fetchImpl: page(PAGE, false) }), null, 'HTTP error');
  assert.equal(await fetchFuelPrices('ราคาน้ำมันดีเซลวันนี้', { fetchImpl: async () => { throw new Error('offline'); } }), null, 'offline');
  assert.equal(await fetchFuelPrices('ราคาน้ำมันดีเซลวันนี้', { fetchImpl: page('<html></html>') }), null, 'layout changed');
});

test('search v6 answers pump prices from the price page, and falls back to research when it fails', async () => {
  const realFetch = globalThis.fetch;
  try {
    const s = new SearchV6Service(); let researched = 0;
    s.call = async () => { researched++; return { ok: true, sources: [{ n: 1, title: 'ลิงก์', url: 'https://example.org/oil', passage: 'เช็กราคาน้ำมันได้ที่นี่', read: true }] }; };
    globalThis.fetch = page();
    const r = await s.search('ค้นเว็บ ราคาน้ำมันดีเซลวันนี้', 4);
    assert.equal(researched, 0);
    assert.equal(r.providerDiagnostics.engine, 'kapook-gasprice');
    assert.equal(r.results[0].url, FUEL_URL);
    assert.match(r.results[0].snippet, /ปตท\.: ดีเซลพรีเมียม 50\.05 · ดีเซล B7 43\.54/);
    assert.equal(r.results[0].publishedAt, '2026-10-24T00:00:00+07:00');
    globalThis.fetch = async () => { throw new Error('offline'); };
    const fallback = await s.search('ราคาน้ำมันดีเซลตอนนี้เท่าไหร่', 4);
    assert.equal(researched, 1);
    assert.equal(fallback.providerDiagnostics.engine, 'search-v6');
  } finally { globalThis.fetch = realFetch; }
});

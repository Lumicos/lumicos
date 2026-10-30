import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicKnowledgeRouter } from '../knowledge/router/router.mjs';

const router = new DeterministicKnowledgeRouter();
const afterPrice = { previousQuery: 'คิด VAT 7% ของ 1,500 บาทให้หน่อย ราคานี้ยังไม่รวม VAT', previousRoute: 'LOCAL' };

test('unit conversions stay off the web, even right after a turn that mentioned a price', () => {
  for (const [query, context] of [['100 ไมล์ กี่กิโลเมตร', afterPrice], ['100 ไมล์ กี่กิโลเมตร'], ['30 องศาเซลเซียส เป็นฟาเรนไฮต์เท่าไหร่'], ['แปลง 5 ฟุต เป็นเซนติเมตร'], ['10 ปอนด์ กี่กิโลกรัม']]) {
    const d = router.route({ query, context });
    assert.equal(d.route, 'DIRECT', query);
    assert.equal(d.reason, 'unit-conversion', query);
  }
});

test('money, prices, "today" and explicit web commands are not treated as unit conversions', () => {
  for (const query of ['1 ดอลลาร์ กี่บาท', '100 ปอนด์ เป็นเงินไทยเท่าไหร่', 'น้ำมัน 1 ลิตร ราคาเท่าไหร่วันนี้', 'ค้นเว็บ 100 ไมล์ กี่กิโลเมตร']) {
    assert.notEqual(router.route({ query }).reason, 'unit-conversion', query);
  }
  assert.equal(router.route({ query: 'ค้นเว็บ 100 ไมล์ กี่กิโลเมตร' }).route, 'WEB');
  assert.equal(router.route({ query: 'น้ำมัน 1 ลิตร ราคาเท่าไหร่วันนี้' }).route, 'WEB');
  assert.equal(router.route({ query: 'แล้วเมื่อวานล่ะ', context: { previousQuery: 'ค้นเว็บ ราคาทองคำแท่งวันนี้', previousRoute: 'WEB' } }).route, 'WEB');
});

test('currency questions go to the web (rates change daily); unrelated baht amounts do not', () => {
  for (const query of ['1 ดอลลาร์ กี่บาท', '100 เยน เป็นเงินไทยเท่าไหร่', 'แลก 500 ยูโร ได้กี่บาท', '1 usd to thb', '100 บาท เป็นเยนเท่าไหร่']) {
    const d = router.route({ query });
    assert.equal(d.route, 'WEB', query);
  }
  for (const query of ['ผักดอง 20 บาท', 'วอนขอเงิน 100 บาท', 'ไม่ต้องค้นเว็บ 1 ดอลลาร์ กี่บาท']) {
    assert.notEqual(router.route({ query }).route, 'WEB', query);
  }
});

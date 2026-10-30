// claude-20261024: the follow-up "แล้วในคลังความรู้ของเราเขียนไว้ว่ายังไง" (after "ค้นเว็บ การเลือกตั้งปี 2569 …") searched
// the library with "ค้นเว็บ … เขียนไว้ว่ายังไง" and found nothing (Real Chat Check rounds 9 and 10), although the same
// question without the asking words found the note. Web queries also went to the engine with "ค้นเว็บ" in them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripAskWords, stripWebAsk, searchTerms } from '../knowledge/askWords.mjs';
import { SearchV6Service } from '../web/searchV6Service.mjs';

test('library searches drop the words that only say where or how to look', () => {
  assert.equal(stripAskWords('ค้นเว็บ การเลือกตั้งปี 2569 พรรคไหนได้ที่นั่งมากที่สุด แล้วในคลังความรู้ของเราเขียนไว้ว่ายังไง'), 'การเลือกตั้งปี 2569 พรรคไหนได้ที่นั่งมากที่สุด');
  assert.equal(stripAskWords('ดูในคลังความรู้ให้หน่อย การเลือกตั้งปี 2569 พรรคไหนได้ที่นั่งมากที่สุด'), 'การเลือกตั้งปี 2569 พรรคไหนได้ที่นั่งมากที่สุด');
  assert.equal(stripAskWords('ช่วยค้นในอินเทอร์เน็ตให้หน่อย ราคาทองวันนี้'), 'ราคาทองวันนี้');
  assert.equal(stripAskWords('แล้วในคลังความรู้ของเราเขียนไว้ว่ายังไง'), '');
  // topic words stay
  assert.equal(stripAskWords('ใครเขียนหนังสือแฮร์รี่ พอตเตอร์'), 'ใครเขียนหนังสือแฮร์รี่ พอตเตอร์');
  assert.equal(stripAskWords('หาเว็บเรียนภาษาญี่ปุ่นฟรี'), 'หาเว็บเรียนภาษาญี่ปุ่นฟรี', '"find a website" is the topic');
});

// claude-20261024: the research agent's own hint "ในคลังความรู้เขียนเรื่อง X ไว้ว่ายังไง" searched "เขียนเรื่อง ROCm 10 ไว้" and
// did not find the note it had just saved (Real Chat Check, research agent).
test('the topic between the asking words is what gets searched', () => {
  assert.equal(stripAskWords('ในคลังความรู้เขียนเรื่อง ROCm 10 ไว้ว่ายังไง'), 'ROCm 10');
  assert.equal(stripAskWords('ในคลังความรู้เขียนเรื่อง ROCm 10 ของ AMD ไว้ว่ายังไง'), 'ROCm 10 ของ AMD');
  assert.equal(stripAskWords('คลังความรู้บอกเกี่ยวกับรถไฟฟ้าสายสีม่วงว่าอะไรบ้าง'), 'รถไฟฟ้าสายสีม่วง');
  assert.equal(stripAskWords('ในคลังความรู้มีอะไรเกี่ยวกับ ROCm 10 บ้าง'), 'ROCm 10');
  assert.equal(stripAskWords('ในคลังความรู้มีข้อมูลเรื่อง Gemma 4 ไหม'), 'Gemma 4 ไหม');
  // words that only look like asking words stay
  assert.equal(stripAskWords('จดหมายเขียนไว้ว่าอะไร'), 'จดหมาย');
  assert.equal(stripAskWords('บันทึกประชุมเขียนไว้ว่ายังไง'), 'บันทึกประชุม');
  assert.equal(stripAskWords('ใครเขียนเรื่องแฮร์รี่ พอตเตอร์'), 'ใครเขียนเรื่องแฮร์รี่ พอตเตอร์');
});

test('a follow-up that is only asking words searches with the previous question', () => {
  assert.deepEqual(searchTerms('แล้วในคลังความรู้ของเราเขียนไว้ว่ายังไง', 'ค้นเว็บ การเลือกตั้งปี 2569 พรรคไหนได้ที่นั่งมากที่สุด'),
    { query: 'การเลือกตั้งปี 2569 พรรคไหนได้ที่นั่งมากที่สุด', context: '' });
  assert.deepEqual(searchTerms('ของปี 2026 สิ', 'แชมป์ฟุตบอลโลก'), { query: 'ของปี 2026 สิ', context: 'แชมป์ฟุตบอลโลก' });
  assert.deepEqual(searchTerms('ค้นเว็บ', ''), { query: 'ค้นเว็บ', context: '' }, 'nothing left and no context: search as typed');
});

test('web queries lose only the "ค้นเว็บ" command', () => {
  assert.equal(stripWebAsk('ค้นเว็บ ราคาทองคำแท่งวันนี้'), 'ราคาทองคำแท่งวันนี้');
  assert.equal(stripWebAsk('แมวกินอะไรได้บ้าง'), 'แมวกินอะไรได้บ้าง', 'nothing else changes');
});

test('search v6 sends the topic without "ค้นเว็บ" to the engine', async () => {
  const s = new SearchV6Service(); const seen = {};
  s.call = async (tool, args) => { seen.args = args; return { ok: true, sources: [{ n: 1, title: 'ข่าว', url: 'https://example.org/a', passage: 'ผลเลือกตั้ง', read: true }] }; };
  await s.search('ค้นเว็บ การเลือกตั้งปี 2569 พรรคไหนได้ที่นั่งมากที่สุด', 4);
  assert.equal(seen.args.question, 'การเลือกตั้งปี 2569 พรรคไหนได้ที่นั่งมากที่สุด');
  assert.ok(seen.args.queries.every((q) => !q.includes('ค้นเว็บ')), JSON.stringify(seen.args.queries));
});

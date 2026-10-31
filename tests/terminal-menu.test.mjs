import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  createMenuState,
  applyMenuKey,
  selectedIds,
  renderMenu,
  renderMenuLines,
  selectMenuFallback,
  parseKey,
  truncateLine,
  displayWidth,
  summaryLine,
  paintFrame,
} from '../src/terminalMenu.mjs';
import {Writable} from 'node:stream';

const items = [
  {id: 'a', label: 'Alpha', hint: 'first', recommended: true},
  {id: 'b', label: 'Bravo', hint: 'second'},
  {id: 'c', label: 'Charlie', hint: 'third', recommended: true},
];

test('createMenuState preselects defaults and highlights first selected', () => {
  const s = createMenuState({items, multi: true, selected: [0, 2]});
  assert.equal(s.cursor, 0);
  assert.deepEqual(selectedIds(s).sort(), ['a', 'c']);
});

test('arrow keys move cursor with wrap-around; single-select tracks selection', () => {
  let s = createMenuState({items, multi: false, selected: [0]});
  s = applyMenuKey(s, 'down');
  assert.equal(s.cursor, 1);
  assert.deepEqual(selectedIds(s), ['b']);
  s = applyMenuKey(s, 'up');
  assert.equal(s.cursor, 0);
  s = applyMenuKey(s, 'up');
  assert.equal(s.cursor, 2);
  s = applyMenuKey(s, 'down');
  assert.equal(s.cursor, 0);
});

test('space toggles multi-select without moving cursor', () => {
  let s = createMenuState({items, multi: true, selected: [0]});
  s = applyMenuKey(s, 'down');
  s = applyMenuKey(s, 'space');
  assert.equal(s.cursor, 1);
  assert.deepEqual(selectedIds(s).sort(), ['a', 'b']);
  s = applyMenuKey(s, 'space');
  assert.deepEqual(selectedIds(s), ['a']);
});

test('enter confirms; escape and ctrl-c cancel', () => {
  let s = createMenuState({items, multi: true, selected: [1]});
  s = applyMenuKey(s, 'enter');
  assert.equal(s.done, true);
  assert.equal(s.cancelled, false);
  assert.deepEqual(selectedIds(s), ['b']);
  s = createMenuState({items, multi: true, selected: [0]});
  s = applyMenuKey(s, 'escape');
  assert.equal(s.cancelled, true);
  s = createMenuState({items, multi: true, selected: [0]});
  s = applyMenuKey(s, 'ctrl-c');
  assert.equal(s.cancelled, true);
});

test('parseKey handles CSI, SS3, and Windows 0xE0 arrow sequences', () => {
  assert.equal(parseKey('\x1b[A'), 'up');
  assert.equal(parseKey('\x1b[B'), 'down');
  assert.equal(parseKey('\x1bOA'), 'up');
  assert.equal(parseKey('\x1bOB'), 'down');
  assert.equal(parseKey('\x1b[1;5A'), 'up');
  assert.equal(parseKey(Buffer.from([0xe0, 0x48])), 'up');
  assert.equal(parseKey(Buffer.from([0xe0, 0x50])), 'down');
  assert.equal(parseKey('\r'), 'enter');
  assert.equal(parseKey(' '), 'space');
  assert.equal(parseKey('\x03'), 'ctrl-c');
  assert.equal(parseKey('\x1b'), 'escape');
  assert.equal(parseKey('x'), null);
});

test('renderMenuLines snapshot: title, instruction, checkboxes, footer', () => {
  const s = createMenuState({items, multi: true, selected: [0, 2]});
  const lines = renderMenuLines(s, {
    title: 'เลือกโมเดล / Select models',
    instruction: '↑↓ เลื่อน · Space เลือก/ไม่เลือก · Enter ยืนยัน',
    color: false,
    columns: 72,
  });
  assert.equal(lines.length, 2 + items.length + 1);
  assert.equal(lines[0], 'เลือกโมเดล / Select models');
  assert.match(lines[1], /Space/);
  assert.match(lines[2], /^> \[x\] Alpha — first \(แนะนำ\)$/);
  assert.match(lines[3], /^  \[ \] Bravo — second$/);
  assert.match(lines[4], /^  \[x\] Charlie — third \(แนะนำ\)$/);
  assert.match(lines[5], /เลือกแล้ว 2\/3/);
  // Plain string form
  const text = renderMenu(s, {title: 'Pick', color: false, columns: 72});
  assert.match(text, /Pick/);
  assert.match(text, /> \[x\] Alpha/);
});

test('truncateLine keeps width under columns (Thai-safe conservative)', () => {
  const long = 'สวัสดีครับนี่คือข้อความยาวมากสำหรับทดสอบการตัดบรรทัดในเมนู';
  const t = truncateLine(long, 20);
  assert.ok(displayWidth(t) <= 20);
  assert.ok(t.endsWith('…'));
});

test('summaryLine lists selected labels', () => {
  const s = createMenuState({items, multi: true, selected: [0, 2]});
  assert.match(summaryLine(s), /Alpha, Charlie/);
});

test('paintFrame rewrites in place without clearing the whole screen', () => {
  let data = '';
  const out = new Writable({
    write(chunk, _enc, cb) { data += chunk.toString(); cb(); },
  });
  const a = ['title', 'hint', '> [x] one', '  [ ] two', 'footer'];
  paintFrame(out, a, {first: true});
  assert.ok(!data.includes('\x1b[2J'), 'must not clear whole screen');
  assert.ok(data.includes('title'));
  const before = data;
  paintFrame(out, ['title', 'hint', '  [ ] one', '> [x] two', 'footer'], {first: false, previousRows: a.length});
  assert.ok(data.length > before.length);
  assert.ok(data.includes('\x1b['), 'uses CSI to move/clear lines');
  assert.ok(!data.includes('\x1b[2J'));
});

test('numbered fallback uses defaults on empty Enter', async () => {
  const ids = await selectMenuFallback(
    {items, multi: true, selected: [0, 2], title: 'T'},
    {askFn: async () => ''},
  );
  assert.deepEqual(ids.sort(), ['a', 'c']);
});

test('numbered fallback parses comma-separated choices', async () => {
  const ids = await selectMenuFallback(
    {items, multi: true, selected: [0], title: 'T'},
    {askFn: async () => '2,3'},
  );
  assert.deepEqual(ids.sort(), ['b', 'c']);
});

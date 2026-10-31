import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  createMenuState,
  applyMenuKey,
  selectedIds,
  renderMenu,
  selectMenuFallback,
} from '../src/terminalMenu.mjs';

const items = [
  {id: 'a', label: 'Alpha'},
  {id: 'b', label: 'Bravo'},
  {id: 'c', label: 'Charlie'},
];

test('createMenuState preselects defaults and highlights first selected', () => {
  const s = createMenuState({items, multi: true, selected: [0, 2]});
  assert.equal(s.cursor, 0);
  assert.deepEqual(selectedIds(s).sort(), ['a', 'c']);
});

test('arrow keys move cursor; single-select tracks selection', () => {
  let s = createMenuState({items, multi: false, selected: [0]});
  s = applyMenuKey(s, 'down');
  assert.equal(s.cursor, 1);
  assert.deepEqual(selectedIds(s), ['b']);
  s = applyMenuKey(s, 'up');
  assert.equal(s.cursor, 0);
  assert.deepEqual(selectedIds(s), ['a']);
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

test('enter confirms; escape cancels', () => {
  let s = createMenuState({items, multi: true, selected: [1]});
  s = applyMenuKey(s, 'enter');
  assert.equal(s.done, true);
  assert.equal(s.cancelled, false);
  assert.deepEqual(selectedIds(s), ['b']);
  s = createMenuState({items, multi: true, selected: [0]});
  s = applyMenuKey(s, 'escape');
  assert.equal(s.cancelled, true);
  assert.equal(s.done, true);
});

test('renderMenu shows highlight and bilingual checkbox marks', () => {
  const s = createMenuState({items, multi: true, selected: [0]});
  const text = renderMenu(s, {title: 'Pick'});
  assert.match(text, /Pick/);
  assert.match(text, /> \[x\] Alpha/);
  assert.match(text, /\[ \] Bravo/);
  assert.match(text, /Space/);
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

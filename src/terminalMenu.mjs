/** Arrow-key terminal menus for the installer. No deps; falls back when stdin is not a TTY. */
import {createInterface} from 'node:readline/promises';

const ESC = '\x1b[';
const hide = `${ESC}?25l`;
const show = `${ESC}?25h`;
const clearLine = `\r${ESC}2K`;

export function createMenuState({items, multi = false, selected = []} = {}) {
  if (!items?.length) throw Error('Menu needs at least one item');
  const sel = new Set();
  for (const i of selected) if (Number.isInteger(i) && i >= 0 && i < items.length) sel.add(i);
  if (!multi && !sel.size) sel.add(0);
  return {
    items: items.map((it) => typeof it === 'string' ? {id: it, label: it} : {...it, label: it.label ?? String(it.id)}),
    multi: !!multi,
    cursor: Math.min([...sel][0] ?? 0, items.length - 1),
    selected: sel,
    done: false,
    cancelled: false,
  };
}

/** Apply one key. Returns next state (immutable-ish copy). */
export function applyMenuKey(state, key) {
  if (state.done || state.cancelled) return state;
  const next = {...state, selected: new Set(state.selected)};
  if (key === 'up' || key === '\x1b[A' || key === 'k') {
    next.cursor = (next.cursor + next.items.length - 1) % next.items.length;
    if (!next.multi) { next.selected = new Set([next.cursor]); }
    return next;
  }
  if (key === 'down' || key === '\x1b[B' || key === 'j') {
    next.cursor = (next.cursor + 1) % next.items.length;
    if (!next.multi) { next.selected = new Set([next.cursor]); }
    return next;
  }
  if (key === 'space' || key === ' ') {
    if (!next.multi) return next;
    if (next.selected.has(next.cursor)) next.selected.delete(next.cursor);
    else next.selected.add(next.cursor);
    return next;
  }
  if (key === 'enter' || key === '\r' || key === '\n') {
    if (!next.multi) next.selected = new Set([next.cursor]);
    next.done = true;
    return next;
  }
  if (key === 'escape' || key === '\x1b' || key === 'q' || key === '\x03') {
    next.cancelled = true;
    next.done = true;
    return next;
  }
  return next;
}

export function selectedIds(state) {
  return [...state.selected].sort((a, b) => a - b).map((i) => state.items[i].id);
}

export function renderMenu(state, {title, hint, bilingual = true} = {}) {
  const lines = [];
  if (title) lines.push(title);
  if (hint) lines.push(hint);
  else if (bilingual) {
    lines.push(state.multi
      ? '↑/↓ เลือก · Space สลับ · Enter ยืนยัน  |  ↑/↓ move · Space toggle · Enter confirm'
      : '↑/↓ เลือก · Enter ยืนยัน  |  ↑/↓ move · Enter confirm');
  }
  for (let i = 0; i < state.items.length; i++) {
    const on = state.selected.has(i);
    const cur = i === state.cursor;
    const mark = state.multi ? (on ? '[x]' : '[ ]') : (cur ? '(•)' : '( )');
    const prefix = cur ? '>' : ' ';
    const label = state.items[i].label + (state.items[i].hint ? `  — ${state.items[i].hint}` : '');
    lines.push(`${prefix} ${mark} ${label}`);
  }
  return lines.join('\n');
}

function paint(output, text, first) {
  const rows = text.split('\n');
  if (!first) output.write(`${ESC}${rows.length}A`);
  for (let i = 0; i < rows.length; i++) {
    output.write(clearLine + rows[i] + (i < rows.length - 1 ? '\n' : ''));
  }
}

async function readRawKey(input) {
  return new Promise((resolve, reject) => {
    const onData = (buf) => {
      cleanup();
      const s = buf.toString('utf8');
      if (s === '\x03') return resolve('\x03');
      if (s.startsWith('\x1b[')) {
        const c = s[2];
        if (c === 'A') return resolve('up');
        if (c === 'B') return resolve('down');
        return resolve(s);
      }
      if (s === '\x1b') return resolve('escape');
      if (s === '\r' || s === '\n') return resolve('enter');
      if (s === ' ') return resolve('space');
      resolve(s);
    };
    const onError = (e) => { cleanup(); reject(e); };
    const cleanup = () => { input.off('data', onData); input.off('error', onError); };
    input.on('data', onData);
    input.on('error', onError);
  });
}

/** Numbered / typed fallback when stdin is not a TTY. */
export async function selectMenuFallback(options, {input = process.stdin, output = process.stdout, askFn} = {}) {
  const state0 = createMenuState(options);
  const title = options.title || 'Select:';
  output.write(title + '\n');
  state0.items.forEach((it, i) => {
    const def = state0.selected.has(i) ? ' (default)' : '';
    output.write(`  ${i + 1}. ${it.label}${def}\n`);
  });
  if (state0.multi) {
    const def = [...state0.selected].sort((a, b) => a - b).map((i) => i + 1).join(',') || 'none';
    const prompt = `Enter numbers separated by commas [${def}], or Enter for defaults: `;
    let answer;
    if (askFn) answer = await askFn(prompt, def);
    else {
      const rl = createInterface({input, output});
      try { answer = await rl.question(prompt); } finally { rl.close(); }
    }
    const raw = String(answer ?? '').trim();
    if (!raw) return selectedIds(state0);
    const nums = raw.split(/[,;\s]+/).map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= state0.items.length);
    if (!nums.length) return selectedIds(state0);
    return [...new Set(nums)].sort((a, b) => a - b).map((n) => state0.items[n - 1].id);
  }
  const def = (state0.cursor + 1);
  const prompt = `Enter number [${def}]: `;
  let answer;
  if (askFn) answer = await askFn(prompt, String(def));
  else {
    const rl = createInterface({input, output});
    try { answer = await rl.question(prompt); } finally { rl.close(); }
  }
  const n = Number(String(answer ?? '').trim() || def);
  if (!Number.isInteger(n) || n < 1 || n > state0.items.length) return selectedIds(createMenuState({...options, selected: [state0.cursor]}));
  return [state0.items[n - 1].id];
}

/**
 * Interactive arrow-key menu. Falls back to numbered prompts when not a TTY.
 * @returns {Promise<string[]>} selected item ids
 */
export async function selectMenu(options, {input = process.stdin, output = process.stdout, askFn} = {}) {
  if (askFn || !input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    return selectMenuFallback(options, {input, output, askFn});
  }
  let state = createMenuState(options);
  const frame = () => renderMenu(state, {title: options.title, hint: options.hint, bilingual: options.bilingual !== false});
  let first = true;
  input.setRawMode(true);
  input.resume();
  output.write(hide);
  try {
    while (!state.done) {
      paint(output, frame(), first);
      first = false;
      const key = await readRawKey(input);
      state = applyMenuKey(state, key);
    }
    output.write('\n');
  } finally {
    try { input.setRawMode(false); } catch {}
    output.write(show);
  }
  if (state.cancelled) return selectedIds(createMenuState(options)); // keep defaults on cancel rather than abort install
  return selectedIds(state);
}

/** Single-choice Yes/No style menu. Returns boolean. */
export async function confirmMenu({question, defaultYes = true, yesLabel = 'Yes / ใช่', noLabel = 'No / ไม่'} = {}, io = {}) {
  const ids = await selectMenu({
    title: question,
    multi: false,
    items: [
      {id: 'yes', label: yesLabel},
      {id: 'no', label: noLabel},
    ],
    selected: [defaultYes ? 0 : 1],
  }, io);
  return ids[0] === 'yes';
}

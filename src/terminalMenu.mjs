/** Arrow-key terminal menus for the installer. No deps; falls back when stdin is not a TTY. */
import {createInterface} from 'node:readline/promises';

const CSI = '\x1b[';
const HIDE = `${CSI}?25l`;
const SHOW = `${CSI}?25h`;
const CLEAR_LINE = `\r${CSI}2K`;
const INV = `${CSI}7m`;
const CYAN = `${CSI}36m`;
const DIM = `${CSI}2m`;
const RESET = `${CSI}0m`;
const BOLD = `${CSI}1m`;

/** Enable VT processing on Windows console when possible (Node 20+ / Windows 10+). */
export function enableWindowsVt(stream = process.stdout) {
  if (process.platform !== 'win32' || !stream?.isTTY) return !!stream?.isTTY;
  try {
    // Node enables ENABLE_VIRTUAL_TERMINAL_PROCESSING for stdout TTYs when available.
    if (typeof stream.setDefaultEncoding === 'function') stream.setDefaultEncoding('utf8');
    return true;
  } catch {
    return false;
  }
}

/** Normalize raw stdin chunks to logical keys. Handles CSI, SS3, and Win32 \xe0 prefixes. */
export function parseKey(chunk) {
  if (chunk == null) return null;
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'binary');
  if (!buf.length) return null;
  // Ctrl+C
  if (buf[0] === 0x03) return 'ctrl-c';
  // Windows conhost extended keys: 0xE0 / 0x00 then scan code
  if ((buf[0] === 0xe0 || buf[0] === 0x00) && buf.length >= 2) {
    const code = buf[1];
    if (code === 0x48) return 'up';
    if (code === 0x50) return 'down';
    if (code === 0x4b) return 'left';
    if (code === 0x4d) return 'right';
    return null; // ignore other extended keys (Home/End/etc.) without acting
  }
  const s = buf.toString('utf8');
  if (s === '\r' || s === '\n' || s === '\r\n') return 'enter';
  if (s === ' ') return 'space';
  if (s === 'q' || s === 'Q') return 'escape';
  if (s === 'k' || s === 'K') return 'up';
  if (s === 'j' || s === 'J') return 'down';
  // ESC alone
  if (s === '\x1b') return 'escape';
  // CSI: ESC [ A / ESC [ B  or  ESC [ 1 ; N A (modifiers — treat as arrow)
  let m = s.match(/^\x1b\[(?:\d+;)?\d*([A-D])/);
  if (m) {
    return {A: 'up', B: 'down', C: 'right', D: 'left'}[m[1]];
  }
  // SS3 (application cursor): ESC O A
  m = s.match(/^\x1bO([A-D])/);
  if (m) {
    return {A: 'up', B: 'down', C: 'right', D: 'left'}[m[1]];
  }
  // Partial/unknown escape: ignore (do not cancel on incomplete sequences)
  if (s.startsWith('\x1b')) return null;
  return null;
}

/** Conservative display width: ASCII=1, Thai/CJK ~2, combining marks ~0. Cap for truncate. */
export function displayWidth(str) {
  let w = 0;
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) continue;
    if (cp >= 0x300 && cp <= 0x36f) continue; // combining
    if (cp >= 0xe31 && cp <= 0xe3a) continue; // Thai vowels/tone (approx)
    if (cp >= 0xe47 && cp <= 0xe4e) continue;
    if (cp > 0xff) w += 2;
    else w += 1;
  }
  return w;
}

export function truncateLine(str, maxCols) {
  const s = String(str ?? '');
  if (!maxCols || maxCols < 8) return s;
  if (displayWidth(s) <= maxCols) return s;
  let out = '';
  let w = 0;
  const budget = maxCols - 1;
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > budget) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

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

/** Apply one normalized key. Returns next state. */
export function applyMenuKey(state, key) {
  if (state.done || state.cancelled) return state;
  const normalized = typeof key === 'string' && key.startsWith('\x1b') ? parseKey(key) : key;
  if (normalized == null) return state;
  const next = {...state, selected: new Set(state.selected)};
  if (normalized === 'up') {
    next.cursor = (next.cursor + next.items.length - 1) % next.items.length;
    if (!next.multi) next.selected = new Set([next.cursor]);
    return next;
  }
  if (normalized === 'down') {
    next.cursor = (next.cursor + 1) % next.items.length;
    if (!next.multi) next.selected = new Set([next.cursor]);
    return next;
  }
  if (normalized === 'space') {
    if (!next.multi) return next;
    if (next.selected.has(next.cursor)) next.selected.delete(next.cursor);
    else next.selected.add(next.cursor);
    return next;
  }
  if (normalized === 'enter') {
    if (!next.multi) next.selected = new Set([next.cursor]);
    next.done = true;
    return next;
  }
  if (normalized === 'escape' || normalized === 'ctrl-c') {
    next.cancelled = true;
    next.done = true;
    return next;
  }
  return next;
}

export function selectedIds(state) {
  return [...state.selected].sort((a, b) => a - b).map((i) => state.items[i].id);
}

export function summaryLine(state, {prefix = 'เลือกแล้ว / Selected:'} = {}) {
  const labels = [...state.selected].sort((a, b) => a - b).map((i) => state.items[i].label);
  if (!labels.length) return `${prefix} (none / ไม่เลือก)`;
  return `${prefix} ${labels.join(', ')}`;
}

function instructionLine(multi) {
  return multi
    ? '↑↓ เลื่อน · Space เลือก/ไม่เลือก · Enter ยืนยัน  |  ↑↓ move · Space toggle · Enter confirm'
    : '↑↓ เลื่อน · Enter ยืนยัน  |  ↑↓ move · Enter confirm';
}

function footerLine(state) {
  const n = state.selected.size;
  const total = state.items.length;
  return `เลือกแล้ว ${n}/${total} · Selected ${n}/${total}`;
}

function itemLine(state, i, {color = true, cols} = {}) {
  const it = state.items[i];
  const on = state.selected.has(i);
  const cur = i === state.cursor;
  const mark = state.multi ? (on ? '[x]' : '[ ]') : (on ? '(*)' : '( )');
  const pointer = cur ? '>' : ' ';
  const desc = it.hint || it.desc || it.size || '';
  const tag = it.recommended ? 'แนะนำ' : '';
  let body = `${pointer} ${mark} ${it.label}`;
  if (desc) body += ` — ${desc}`;
  if (tag) body += ` (${tag})`;
  body = truncateLine(body, cols);
  if (color && cur) return `${INV}${CYAN}${body}${RESET}`;
  return body;
}

/**
 * Build menu frame lines (no trailing newline on last). Stable row count for redraw.
 * @returns {string[]}
 */
export function renderMenuLines(state, {
  title = '',
  instruction,
  bilingual = true,
  color = true,
  columns = 80,
} = {}) {
  const cols = Math.max(40, Number(columns) || 80);
  const lines = [];
  lines.push(truncateLine(title || (state.multi ? 'เลือก / Select' : 'เลือกหนึ่งรายการ / Choose one'), cols));
  lines.push(truncateLine(instruction || (bilingual ? instructionLine(state.multi) : instructionLine(state.multi).split('|')[1].trim()), cols));
  for (let i = 0; i < state.items.length; i++) {
    lines.push(itemLine(state, i, {color, cols}));
  }
  lines.push(truncateLine(footerLine(state), cols));
  return lines;
}

/** String form of the menu (joined with newlines). */
export function renderMenu(state, opts = {}) {
  return renderMenuLines(state, opts).join('\n');
}

/** Redraw in place: move up N lines, clear each, rewrite. Does not clear the whole screen. */
export function paintFrame(output, lines, {first = false, previousRows = 0} = {}) {
  const rows = lines.length;
  if (!first && previousRows > 0) {
    // Move cursor to start of the previous frame (up previousRows-1 if we ended mid-line without final \n after last row)
    // After painting we leave cursor on the last line without an extra blank. So go up (rows-1).
    const up = Math.max(previousRows - 1, 0);
    if (up > 0) output.write(`${CSI}${up}A`);
  }
  for (let i = 0; i < rows; i++) {
    output.write(CLEAR_LINE + lines[i]);
    if (i < rows - 1) output.write('\n');
  }
  // If new frame is shorter, clear leftover lines below
  if (!first && previousRows > rows) {
    for (let i = rows; i < previousRows; i++) {
      output.write('\n' + CLEAR_LINE);
    }
    const back = previousRows - rows;
    if (back > 0) output.write(`${CSI}${back}A`);
  }
  return rows;
}

async function readRawKey(input) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let timer = null;
    const finish = (key) => { cleanup(); resolve(key); };
    const onData = (chunk) => {
      buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      // Immediate for non-ESC
      if (buf[0] !== 0x1b && buf[0] !== 0xe0 && buf[0] !== 0x00) {
        return finish(parseKey(buf));
      }
      // Win32 extended: wait for 2 bytes
      if ((buf[0] === 0xe0 || buf[0] === 0x00) && buf.length >= 2) {
        return finish(parseKey(buf.subarray(0, 2)));
      }
      // ESC sequences: allow a short window to complete CSI/SS3
      if (buf[0] === 0x1b) {
        if (buf.length >= 3 || (buf.length === 2 && buf[1] === 0x4f /* O */)) {
          const key = parseKey(buf);
          if (key != null) return finish(key);
        }
        clearTimeout(timer);
        timer = setTimeout(() => finish(parseKey(buf)), 30);
        return;
      }
    };
    const onError = (e) => { cleanup(); reject(e); };
    const cleanup = () => {
      clearTimeout(timer);
      input.off('data', onData);
      input.off('error', onError);
    };
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
    const extra = it.hint ? ` — ${it.hint}` : '';
    output.write(`  ${i + 1}. ${it.label}${extra}${def}\n`);
  });
  if (state0.multi) {
    const def = [...state0.selected].sort((a, b) => a - b).map((i) => i + 1).join(',') || 'none';
    const prompt = `ใส่หมายเลขคั่นด้วยจุลภาค [${def}] / Enter numbers [${def}], or Enter for defaults: `;
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
  const prompt = `ใส่หมายเลข [${def}] / Enter number [${def}]: `;
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
 * Redraws in place (no full-screen clear). Prints a one-line summary after Enter.
 * @returns {Promise<string[]>} selected item ids
 */
export async function selectMenu(options, {input = process.stdin, output = process.stdout, askFn} = {}) {
  if (askFn || !input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    return selectMenuFallback(options, {input, output, askFn});
  }
  const color = enableWindowsVt(output);
  let state = createMenuState(options);
  const columns = Math.max(40, output.columns || Number(process.env.COLUMNS) || 80);
  const build = () => renderMenuLines(state, {
    title: options.title,
    instruction: options.hint || options.instruction,
    bilingual: options.bilingual !== false,
    color,
    columns,
  });

  let previousRows = 0;
  let first = true;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { input.setRawMode(false); } catch {}
    output.write(SHOW);
  };

  const onSigInt = () => {
    state = {...state, cancelled: true, done: true};
  };

  input.setRawMode(true);
  input.resume();
  output.write(HIDE);
  process.once('SIGINT', onSigInt);

  try {
    while (!state.done) {
      const lines = build();
      previousRows = paintFrame(output, lines, {first, previousRows});
      first = false;
      const key = await readRawKey(input);
      if (key === 'ctrl-c') {
        state = applyMenuKey(state, 'ctrl-c');
        break;
      }
      const next = applyMenuKey(state, key);
      // Ignore null/unknown — no redraw flicker from no-ops is fine; still cheap to paint
      if (next === state && key == null) continue;
      state = next;
    }
    // Move to line after menu, clear residue, show summary
    output.write('\n' + CLEAR_LINE);
    const finalState = state.cancelled ? createMenuState(options) : state;
    output.write(summaryLine(finalState) + '\n');
  } finally {
    process.off('SIGINT', onSigInt);
    cleanup();
  }
  if (state.cancelled) return selectedIds(createMenuState(options));
  return selectedIds(state);
}

/** Single-choice Yes/No style menu. Returns boolean. */
export async function confirmMenu({question, defaultYes = true, yesLabel = 'Yes / ใช่', noLabel = 'No / ไม่'} = {}, io = {}) {
  const ids = await selectMenu({
    title: question,
    instruction: '↑↓ เลื่อน · Enter ยืนยัน  |  ↑↓ move · Enter confirm',
    multi: false,
    items: [
      {id: 'yes', label: yesLabel},
      {id: 'no', label: noLabel},
    ],
    selected: [defaultYes ? 0 : 1],
  }, io);
  return ids[0] === 'yes';
}

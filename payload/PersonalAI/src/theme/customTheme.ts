/**
 * AI-designed themes. The assistant only picks a few colours (and a corner radius);
 * every other token is derived here, so a theme can never break layout or fonts.
 * Stored per device in localStorage, applied as inline CSS variables on <html>.
 */
export interface CustomTheme { name: string; mode: 'light' | 'dark'; bg: string; surface: string; text: string; accent: string; radius: number }
interface Store { active: CustomTheme | null; previous: CustomTheme | null; saved: CustomTheme[] }

const KEY = 'lumicos.customTheme.v1';
const EVENT = 'lumicos-custom-theme';
const VARS = ['--bg', '--bg-elev', '--surface', '--surface-2', '--surface-hover', '--border', '--border-strong', '--text', '--text-2', '--muted',
  '--accent', '--accent-2', '--accent-soft', '--accent-contrast', '--user-bubble', '--code-bg', '--page-bg', '--logo-moon', '--logo-star',
  '--composer-bg', '--composer-button-bg', '--composer-button-fg', '--radius', 'color-scheme'];

type RGB = [number, number, number];
const parse = (s: string): RGB | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(s).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
};
const hex = (c: RGB) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;
const lum = (c: RGB) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const contrast = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgba = (c: RGB, a: number) => `rgba(${c.map(Math.round).join(',')},${a})`;
const WHITE: RGB = [255, 255, 255], BLACK: RGB = [17, 17, 17];

export function checkTheme(t: CustomTheme): string | null {
  const c = { bg: parse(t.bg), surface: parse(t.surface), text: parse(t.text), accent: parse(t.accent) };
  for (const [k, v] of Object.entries(c)) if (!v) return `สี ${k} ต้องเป็นรหัส hex เช่น #1a2b3c`;
  const { bg, surface, text, accent } = c as Record<string, RGB>;
  const isDark = lum(bg) < 0.35;
  if (t.mode === 'dark' && !isDark) return 'mode เป็น dark แต่พื้นหลัง bg สว่างเกินไป ให้ใช้สีเข้มกว่านี้';
  if (t.mode === 'light' && isDark) return 'mode เป็น light แต่พื้นหลัง bg มืดเกินไป ให้ใช้สีอ่อนกว่านี้';
  if (contrast(text, bg) < 4.5) return `ตัวอักษรกับพื้นหลังตัดกันน้อยเกินไป (${contrast(text, bg).toFixed(1)}:1 ต้องอย่างน้อย 4.5) ให้ปรับ text หรือ bg`;
  if (contrast(text, surface) < 4.5) return `ตัวอักษรกับสีการ์ด surface ตัดกันน้อยเกินไป (${contrast(text, surface).toFixed(1)}:1 ต้องอย่างน้อย 4.5)`;
  if (contrast(accent, bg) < 2.2) return `สีเน้น accent กลืนกับพื้นหลัง (${contrast(accent, bg).toFixed(1)}:1 ต้องอย่างน้อย 2.2) ให้เลือกสีที่สว่าง/เข้มกว่านี้`;
  return null;
}

export function deriveVars(t: CustomTheme): Record<string, string> {
  const bg = parse(t.bg)!, surface = parse(t.surface)!, text = parse(t.text)!, accent = parse(t.accent)!;
  const dark = t.mode === 'dark';
  const accent2 = mix(accent, dark ? WHITE : BLACK, 0.12);
  const onAccent = contrast(WHITE, accent) >= contrast(BLACK, accent) ? WHITE : BLACK;
  let bubble = mix(bg, accent, dark ? 0.28 : 0.2);
  if (contrast(text, bubble) < 4.5) bubble = mix(surface, text, 0.08);
  return {
    '--bg': t.bg, '--page-bg': t.bg, '--bg-elev': hex(mix(bg, text, 0.04)),
    '--surface': t.surface, '--surface-2': hex(mix(surface, text, 0.07)), '--surface-hover': hex(mix(surface, text, 0.12)),
    '--border': rgba(text, 0.12), '--border-strong': rgba(accent, 0.38),
    '--text': t.text, '--text-2': hex(mix(text, bg, 0.2)), '--muted': hex(mix(text, bg, 0.42)),
    '--accent': t.accent, '--accent-2': hex(accent2), '--accent-soft': rgba(accent, 0.16), '--accent-contrast': hex(onAccent),
    '--user-bubble': hex(bubble), '--code-bg': hex(mix(bg, text, 0.06)),
    '--logo-moon': t.accent, '--logo-star': hex(accent2),
    '--composer-bg': t.surface, '--composer-button-bg': t.accent, '--composer-button-fg': hex(onAccent),
    '--radius': `${t.radius}px`, 'color-scheme': t.mode,
  };
}

const empty = (): Store => ({ active: null, previous: null, saved: [] });
function load(): Store {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (s && typeof s === 'object') return { ...empty(), ...s }; } catch { /* ignore */ }
  return empty();
}
function save(s: Store) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }

function paint(t: CustomTheme | null) {
  const root = document.documentElement;
  for (const v of VARS) root.style.removeProperty(v);
  if (t) { for (const [k, v] of Object.entries(deriveVars(t))) root.style.setProperty(k, v); root.dataset.customTheme = '1'; }
  else delete root.dataset.customTheme;
  window.dispatchEvent(new Event(EVENT));
}

export const customTheme = {
  EVENT,
  state: load,
  applyStored() { paint(load().active); },
  set(t: CustomTheme) {
    const s = load();
    const saved = [t, ...s.saved.filter((x) => x.name !== t.name)].slice(0, 12);
    save({ active: t, previous: s.active, saved });
    paint(t);
  },
  revert() { const s = load(); save({ ...s, active: s.previous, previous: null }); paint(s.previous); },
  reset() { const s = load(); save({ ...s, active: null, previous: s.active }); paint(null); },
  remove(name: string) { const s = load(); save({ ...s, saved: s.saved.filter((x) => x.name !== name) }); window.dispatchEvent(new Event(EVENT)); },
  use(name: string): CustomTheme | null { const s = load(); const t = s.saved.find((x) => x.name === name) ?? null; if (t) customTheme.set(t); return t; },
};

/** Handler for the set_theme tool. Returns text for the model; ok=false means it was rejected. */
export function runThemeTool(args: Record<string, unknown>): { ok: boolean; message: string } {
  const action = typeof args.action === 'string' ? args.action : 'apply';
  const s = load();
  if (action === 'list') return { ok: true, message: s.saved.length ? 'ธีมที่บันทึกไว้: ' + s.saved.map((t) => t.name).join(', ') : 'ยังไม่มีธีมที่บันทึกไว้' };
  if (action === 'revert') { if (!s.previous && !s.active) return { ok: false, message: 'ไม่มีธีมให้ย้อนกลับ' }; customTheme.revert(); return { ok: true, message: 'ย้อนกลับธีมก่อนหน้าแล้ว' }; }
  if (action === 'reset') { customTheme.reset(); return { ok: true, message: 'กลับเป็นธีมเดิมของแอปแล้ว (ย้อนกลับได้)' }; }
  if (action === 'use') { const t = customTheme.use(String(args.name ?? '')); return t ? { ok: true, message: `ใช้ธีม ${t.name} แล้ว` } : { ok: false, message: 'ไม่พบธีมชื่อนี้' }; }
  const radius = Math.max(6, Math.min(28, Number(args.radius ?? 14) || 14));
  const t: CustomTheme = {
    name: String(args.name ?? 'ธีมใหม่').trim().slice(0, 24) || 'ธีมใหม่',
    mode: args.mode === 'light' ? 'light' : 'dark',
    bg: String(args.bg ?? ''), surface: String(args.surface ?? ''), text: String(args.text ?? ''), accent: String(args.accent ?? ''), radius,
  };
  const problem = checkTheme(t);
  if (problem) return { ok: false, message: 'ธีมนี้ยังไม่ผ่าน: ' + problem };
  customTheme.set(t);
  return { ok: true, message: `ใช้ธีม ${t.name} แล้ว ผู้ใช้ย้อนกลับได้จากปุ่มที่ขึ้นมุมจอ หรือใน ตั้งค่า > Appearance` };
}

/** Ready-made themes shown in the theme library. */
export const PRESET_THEMES: CustomTheme[] = [
  { name: 'ทะเลยามเย็น', mode: 'dark', bg: '#0f1a24', surface: '#162636', text: '#e6f1f8', accent: '#4fd1c5', radius: 16 },
  { name: 'ซากุระ', mode: 'light', bg: '#fff4f6', surface: '#ffffff', text: '#3a2430', accent: '#d94f78', radius: 20 },
  { name: 'ป่าฝน', mode: 'dark', bg: '#0e1712', surface: '#16241b', text: '#e5f0e8', accent: '#7bd88f', radius: 14 },
  { name: 'อาทิตย์อัสดง', mode: 'dark', bg: '#1c1214', surface: '#2a1a1c', text: '#f6e8e2', accent: '#ff9f5a', radius: 18 },
  { name: 'กระดาษ', mode: 'light', bg: '#f6f2ea', surface: '#fffdf8', text: '#2b2a27', accent: '#b5532f', radius: 10 },
  { name: 'น้ำแข็ง', mode: 'light', bg: '#eef5fa', surface: '#ffffff', text: '#1d2b36', accent: '#2a7fc1', radius: 14 },
  { name: 'ราตรีทอง', mode: 'dark', bg: '#0d0d10', surface: '#17171c', text: '#efeae0', accent: '#e0b95a', radius: 12 },
];

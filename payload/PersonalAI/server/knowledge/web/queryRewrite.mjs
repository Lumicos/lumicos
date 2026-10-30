const THAI = /[\u0E00-\u0E7F]/u;

export function rewriteSearchQuery(query, { now = Date.now() } = {}) {
  const original = String(query ?? '').replace(/\s+/gu, ' ').trim();
  if (!THAI.test(original)) return { original, providerQuery: original, rewritten: false };

  const terms = [];
  if (/(โมเดล|model)/iu.test(original)) terms.push('models');
  if (/(local\s*ai|เอไอในเครื่อง|รันในเครื่อง|บนเครื่อง)/iu.test(original)) terms.push('local AI', 'open weight', 'on-device');
  if (/(เปิดตัว|เผยแพร่|ออกใหม่)/iu.test(original)) terms.push('released');
  if (/(ล่าสุด|ใหม่|ช่วง\s*7\s*วัน|สัปดาห์นี้)/iu.test(original)) terms.push('latest');
  if (/เพลงใหม่/iu.test(original)) terms.push('new song official');
  if (/(ผลงานใหม่|ผลงานล่าสุด)/iu.test(original)) terms.push('latest release official');
  const names = [
    [/จีซู/iu, 'JISOO'], [/เจนนี่/iu, 'JENNIE'], [/โรเซ่|โรเซ/iu, 'ROSE BLACKPINK'], [/ลิซ่า/iu, 'LISA BLACKPINK'], [/แบล็กพิงก์|แบล็คพิงค์/iu, 'BLACKPINK'],
  ];
  for (const [pattern, latin] of names) if (pattern.test(original)) terms.push(latin);
  if (/(hugging\s*face|ฮักกิงเฟซ)/iu.test(original)) terms.push('site:huggingface.co');
  // Keep the user's market, period and ranking type explicit for the engine (พ.ศ. is sent as ค.ศ.).
  const constraints = extractSearchConstraints(original, { now });
  for (const code of constraints.countries ?? []) terms.push(COUNTRY_TERMS.find((c) => c.code === code).label);
  if (constraints.ranking) terms.push(constraints.ranking === 'box-office-weekly' ? 'weekend box office' : 'box office');
  if (constraints.year !== undefined) terms.push(constraints.month ? `${EN_MONTH_NAMES[constraints.month - 1]} ${constraints.year}` : String(constraints.year));

  // "เมื่อวาน" / "พรุ่งนี้" mean nothing to a search engine: add the actual Thai date (Bangkok), e.g.
  // "ราคาทองคำแท่ง แล้วเมื่อวานล่ะ" → "… 23 ตุลาคม 2569" (claude-20261024: the answer mixed up today and yesterday).
  const shift = RELATIVE_DAYS.find(([re]) => re.test(original))?.[1];
  if (shift !== undefined) terms.push(thaiDate(now + shift * 86_400_000));

  const sevenDays = /ช่วง\s*7\s*วัน|7\s*วันที่ผ่านมา/iu.test(original);
  if (sevenDays) {
    const end = new Date(now); const start = new Date(now - 7 * 86_400_000);
    terms.push(`after:${start.toISOString().slice(0, 10)}`, `before:${new Date(end.getTime() + 86_400_000).toISOString().slice(0, 10)}`);
  }

  // Preserve Latin names/version numbers that may carry the user's exact subject.
  const named = original.match(/[A-Za-z][A-Za-z0-9._/+:-]*(?:\s+[A-Za-z0-9._/+:-]+)*/g) ?? [];
  for (const token of named) if (!/^(local ai|hugging face)$/iu.test(token.trim())) terms.push(token.trim());
  const extra = [...new Set(terms)].filter((t) => !original.includes(t));
  const providerQuery = (extra.length ? `${original} ${extra.join(' ')}` : original).slice(0, 500);
  return { original, providerQuery, rewritten: providerQuery !== original };
}


/* ------------------------------------------------------------------ */
/* Search constraints (country/market, period, ranking type) taken     */
/* only from the user's words, and evidence fit: match/mismatch/unknown */
/* ------------------------------------------------------------------ */

// Country/market names in Thai, English and Japanese. Currency is deliberately not here: it is a hint, not proof.
export const COUNTRY_TERMS = Object.freeze([
  { code: 'JP', label: 'Japan', re: /(ญี่ปุ่น|japan(?:ese)?|日本|area=JP\b)/giu },
  // Thai news brands (ไทยรัฐ, Thai PBS, ไทยโพสต์) name the publisher, not the market.
  { code: 'TH', label: 'Thailand', re: /(ประเทศไทย|(?<!ภาษา)ไทย(?!รัฐ|พีบีเอส|โพสต์)|thailand|\bthai\b(?!\s*pbs|rath))/giu },
  { code: 'KR', label: 'South Korea', re: /(เกาหลี|korea(?:n)?|한국)/giu },
  { code: 'CN', label: 'China', re: /((?<!ภาษา)จีน|\bchina\b|chinese|中国)/giu },
  { code: 'US', label: 'United States', re: /(อเมริกา|สหรัฐ|\b[Uu]nited [Ss]tates\b|\bU\.S\.(?:A\.)?|\bUSA\b|\b[Nn]orth [Aa]merica)/gu },
  { code: 'UK', label: 'United Kingdom', re: /(สหราชอาณาจักร|\b[Uu]nited [Kk]ingdom\b|\bUK\b|\b[Bb]rit(?:ain|ish)\b)/gu },
]);
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const RELATIVE_DAYS = [[/เมื่อวานซืน/u, -2], [/เมื่อวาน/u, -1], [/มะรืน/u, 2], [/พรุ่งนี้/u, 1]];
/** "23 ตุลาคม 2569" for a moment, in Thai (Bangkok) time. */
const thaiDate = (ms) => { const d = new Date(ms + 7 * 3_600_000); return `${d.getUTCDate()} ${THAI_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`; };
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const EN_MONTH_NAMES = EN_MONTHS.map((m) => m[0].toUpperCase() + m.slice(1));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const MONTH_RE = new RegExp(`(${[...THAI_MONTHS, ...THAI_MONTHS_SHORT].map(escape).join('|')}|\\b(?:${EN_MONTHS.join('|')}|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\\.?\\b|(?<![0-9])(?:1[0-2]|[1-9])月)`, 'giu');
export const YEAR_RE = /(?<![0-9])(20[0-4]\d|25[4-8]\d)(?![0-9])/gu;
const BOX_OFFICE = /(ทำเงิน|รายได้(?:หนัง|ภาพยนตร์)?|บ็อกซ์ออฟฟิศ|บ๊อกซ์ออฟฟิศ|box[\s-]*office|興行収入|興収|grossing|grosses)/iu;
const MOVIE = /(หนัง|ภาพยนตร์|movie|film|映画|box[\s-]*office)/iu;
const WEEKLY = /(สัปดาห์|สุดสัปดาห์|weekend|weekly|週末)/iu;
const OFF_TOPIC_FOR_MOVIES = /(ยอดขาย(?:มังงะ|การ์ตูน|หนังสือ)|manga (?:sales|ranking)|book sales|ตาราง(?:ฉาย)?อนิเมะ|anime (?:schedule|season chart)|simulcast|オリコン|music chart|ชาร์ตเพลง)/iu;

const monthIndex = (token) => {
  const t = token.toLowerCase().replace(/\.$/, '');
  let i = THAI_MONTHS.indexOf(token); if (i >= 0) return i + 1;
  i = THAI_MONTHS_SHORT.indexOf(token); if (i >= 0) return i + 1;
  const jp = t.match(/^(\d{1,2})月$/); if (jp) return Number(jp[1]);
  i = EN_MONTHS.findIndex((m) => m === t || m.slice(0, 3) === t || (t === 'sept' && m === 'september'));
  return i >= 0 ? i + 1 : undefined;
};
const toCE = (y) => (y >= 2400 ? y - 543 : y); // พ.ศ. → ค.ศ.
export const yearsIn = (text) => [...new Set([...String(text ?? '').matchAll(YEAR_RE)].map((m) => toCE(Number(m[1]))))];
// English "may" is usually the verb: count it as a month only next to a year ("May 2026").
export const monthsIn = (text) => [...new Set([...String(text ?? '').matchAll(MONTH_RE)]
  .filter((m) => m[1].toLowerCase() !== 'may' || /^\s*,?\s*(?:20[0-4]\d|25[4-8]\d)/u.test(String(text).slice(m.index + m[0].length)))
  .map((m) => monthIndex(m[1])).filter(Boolean))];
export const countriesIn = (text) => COUNTRY_TERMS.filter((c) => { c.re.lastIndex = 0; return c.re.test(String(text ?? '')); }).map((c) => c.code);

/** Constraints stated in the user's text. Source/snippet text must never be passed here. */
export function extractSearchConstraints(text, { now = Date.now() } = {}) {
  const value = String(text ?? '');
  const today = new Date(now);
  const out = {};
  const countries = countriesIn(value);
  if (countries.length) out.countries = countries;
  let years = yearsIn(value);
  if (!years.length && /(ปีนี้|this year)/iu.test(value)) years = [today.getUTCFullYear()];
  if (years.length === 1) out.year = years[0];
  let months = monthsIn(value);
  if (!months.length && /(เดือนนี้|this month)/iu.test(value)) { months = [today.getUTCMonth() + 1]; out.year ??= today.getUTCFullYear(); }
  if (months.length === 1) out.month = months[0];
  if (BOX_OFFICE.test(value)) out.ranking = WEEKLY.test(value) ? 'box-office-weekly' : 'box-office';
  if (MOVIE.test(value)) out.category = 'movie';
  return out;
}

/** Latest user words win per dimension; anything they do not state is inherited. */
export function mergeSearchConstraints(previous = {}, latest = {}) {
  const merged = { ...previous };
  if (latest.countries) merged.countries = latest.countries;
  if (latest.year !== undefined) { merged.year = latest.year; if (latest.month === undefined) delete merged.month; }
  if (latest.month !== undefined) merged.month = latest.month;
  if (latest.ranking) merged.ranking = latest.ranking;
  if (latest.category) merged.category = latest.category;
  return merged;
}

/** Removes constraint words of the dimensions the latest text restates (explicit correction wins). */
export function stripConstraintTerms(text, dimensions = {}) {
  let value = String(text ?? '');
  if (dimensions.countries) for (const c of COUNTRY_TERMS) value = value.replace(c.re, ' ');
  if (dimensions.year !== undefined) value = value.replace(YEAR_RE, ' ').replace(/(ปีนี้|this year)/giu, ' ');
  if (dimensions.year !== undefined || dimensions.month !== undefined) value = value.replace(MONTH_RE, ' ').replace(/(เดือนนี้|this month)/giu, ' ');
  return value.replace(/\s+/gu, ' ').trim();
}

const hasConstraints = (c) => !!(c && (c.countries?.length || c.year !== undefined || c.ranking || c.category));

/** match / mismatch / unknown for one search result. A dimension the snippet does not mention is unknown, never a mismatch. */
export function classifyWebResult(result, constraints) {
  const title = String(result?.title ?? '');
  const snippet = String(result?.snippet ?? '');
  let urlText = ''; try { const u = new URL(String(result?.url ?? '')); urlText = `${u.hostname} ${decodeURIComponent(u.pathname)} ${u.search}`; } catch {}
  const matched = []; const mismatched = []; const unknown = [];
  if (constraints.countries?.length) {
    const wanted = new Set(constraints.countries);
    const found = countriesIn(`${title} ${snippet} ${urlText}`);
    const inTitle = countriesIn(title);
    const hit = found.some((c) => wanted.has(c)); const others = found.filter((c) => !wanted.has(c));
    if (hit && !others.length) matched.push('country');
    else if (!hit && inTitle.some((c) => !wanted.has(c))) mismatched.push('country');
    else unknown.push('country');
  }
  if (constraints.year !== undefined) {
    const titleYears = yearsIn(title); const anyYears = yearsIn(`${title} ${snippet} ${urlText}`);
    const published = Date.parse(String(result?.publishedAt ?? ''));
    if (anyYears.includes(constraints.year)) {
      matched.push('year');
      if (constraints.month !== undefined) {
        const months = monthsIn(`${title} ${snippet}`);
        if (months.includes(constraints.month)) matched.push('month'); else unknown.push('month');
      }
    } else if (titleYears.length) mismatched.push('year'); // a headline about another year ("…2024")
    else if (Number.isFinite(published) && new Date(published).getUTCFullYear() < constraints.year) mismatched.push('published-before-period');
    else unknown.push('year'); // years only in body/footer, or none: not proof either way
  }
  const topical = `${title} ${snippet}`;
  if (constraints.ranking || constraints.category === 'movie') {
    if (BOX_OFFICE.test(topical) || (constraints.category === 'movie' && !constraints.ranking && MOVIE.test(topical))) matched.push('type');
    else if (OFF_TOPIC_FOR_MOVIES.test(topical)) mismatched.push('type');
    else unknown.push('type');
  }
  const verdict = mismatched.length ? 'mismatch' : unknown.length ? 'unknown' : 'match';
  return { verdict, matched, mismatched, unknown };
}

/**
 * Applies classifyWebResult to provider results: mismatches are removed, the rest carry `fit`.
 * Diagnostics are bounded (host + verdict + dimension names), never raw snippets or conversation text.
 */
export function validateWebResults(results = [], constraints = {}, { now = Date.now() } = {}) {
  if (!hasConstraints(constraints) || !results.length) return { results, validation: null };
  const today = new Date(now);
  const periodOpen = constraints.year !== undefined && constraints.month !== undefined
    && (constraints.year > today.getUTCFullYear() || (constraints.year === today.getUTCFullYear() && constraints.month >= today.getUTCMonth() + 1));
  const kept = []; const items = []; const counts = { match: 0, unknown: 0, mismatch: 0 };
  for (const result of results) {
    const fit = classifyWebResult(result, constraints);
    counts[fit.verdict]++;
    let host = ''; try { host = new URL(String(result.url)).hostname; } catch {}
    if (items.length < 8) items.push({ source: String(result.id ?? host).slice(0, 120), host, verdict: fit.verdict, matched: fit.matched, mismatched: fit.mismatched });
    if (fit.verdict !== 'mismatch') kept.push({ ...result, fit: fit.verdict === 'match' ? 'match' : 'unverified' });
  }
  const status = counts.match ? (counts.unknown || counts.mismatch ? 'partial' : 'match') : counts.unknown ? 'unverified' : 'mismatch_only';
  return { results: kept, validation: { status, counts, periodOpen, constraints: { ...constraints }, items } };
}

/** One-line scope note placed before the evidence so the model knows what was and was not confirmed. */
export function evidenceScopeNote(validation, { now = Date.now() } = {}) {
  if (!validation) return '';
  const c = validation.constraints;
  const parts = [];
  if (c.countries?.length) parts.push(`market=${c.countries.map((code) => COUNTRY_TERMS.find((x) => x.code === code)?.label ?? code).join('/')}`);
  if (c.year !== undefined) parts.push(`period=${c.year}${c.month ? '-' + String(c.month).padStart(2, '0') : ''}`);
  if (c.ranking) parts.push(`type=${c.ranking}`);
  const open = validation.periodOpen ? ` That period is not finished as of ${new Date(now).toISOString().slice(0, 10)}: figures can only be month-to-date or weekly, never a complete monthly ranking.` : '';
  return `[Evidence scope] User asked for ${parts.join(', ')}. Sources that contradict it were removed. fit=match states it; fit=unverified does not say (country/period missing in the snippet): use only as a lead, never present it as a confirmed ranking or figure for the requested scope.${open}`;
}

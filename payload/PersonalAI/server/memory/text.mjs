// Lightweight local relevance scoring shared by memory retrieval and file chunk ranking.
// Thai has no spaces between words, so tokens come from Intl.Segmenter (ICU, built into Node).
// Replaceable: an embedding-based ranker can implement the same `score(query, docs)` shape later.

const segmenters = new Map();
function segmenter(locale) {
  if (!segmenters.has(locale)) segmenters.set(locale, new Intl.Segmenter(locale, { granularity: 'word' }));
  return segmenters.get(locale);
}

const STOP = new Set([
  // English
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'be', 'it', 'this', 'that',
  'with', 'as', 'at', 'by', 'i', 'you', 'me', 'my', 'your', 'we', 'our', 'do', 'does', 'can', 'what', 'how',
  'please', 'user', 'users', 's',
  // Thai function words / particles
  'ที่', 'และ', 'ของ', 'ใน', 'ให้', 'ได้', 'ไป', 'มา', 'เป็น', 'จะ', 'ก็', 'ว่า', 'แล้ว', 'นี้', 'นั้น', 'กับ', 'ด้วย',
  'ครับ', 'ค่ะ', 'คะ', 'นะ', 'จ้ะ', 'จ้า', 'หน่อย', 'ไหม', 'มั้ย', 'หรือ', 'อะไร', 'ยังไง', 'อย่างไร', 'ช่วย', 'ฉัน',
  'ผม', 'เรา', 'คุณ', 'มี', 'ไม่', 'อยู่', 'คือ', 'การ', 'ความ', 'บ้าง', 'เลย', 'ตอนนี้', 'ผู้ใช้', 'ผู้', 'ใช้', 'ชอบ', 'ตัว',
]);

const ALIASES = new Map([
  ['แรม', 'ram'],
  ['การ์ดจอ', 'gpu'],
  ['จีพียู', 'gpu'],
]);

/** Lower-cased word tokens (Thai + Latin + numbers), stop words removed. */
export function tokenize(text) {
  const out = [];
  const lower = String(text ?? '').toLowerCase();
  for (const { segment, isWordLike } of segmenter('th').segment(lower)) {
    if (!isWordLike) continue;
    const t = segment.trim();
    if (!t || STOP.has(t)) continue;
    if (/^[a-z]$/.test(t)) continue;
    out.push(ALIASES.get(t) ?? t);
  }
  // Split things like "rx6600" into "rx" + "6600" as extra tokens so "RX 6600" matches.
  for (const t of [...out]) {
    const parts = t.match(/[a-z]+|\d+/g);
    if (parts && parts.length > 1) out.push(...parts.filter((p) => p.length > 1));
  }
  return out;
}

/**
 * BM25-style score of each document for a query.
 * @param {string} query
 * @param {string[]} docs
 * @returns {number[]} one score per doc (0 = no overlap)
 */
export function bm25Scores(query, docs, { k1 = 1.2, b = 0.75 } = {}) {
  const q = [...new Set(tokenize(query))];
  if (!q.length || !docs.length) return docs.map(() => 0);
  const toks = docs.map(tokenize);
  const avgLen = toks.reduce((s, t) => s + t.length, 0) / toks.length || 1;
  const df = new Map();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.length;

  return toks.map((t) => {
    if (!t.length) return 0;
    const tf = new Map();
    for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
    let score = 0;
    for (const w of q) {
      const f = tf.get(w) ?? 0;
      if (!f) continue;
      const n = df.get(w) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * t.length) / avgLen)));
    }
    return score;
  });
}

/** Jaccard similarity of token sets, used to spot duplicate memories. */
export function similarity(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

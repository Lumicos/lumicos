export function freshnessPolicy(query, { now = Date.now() } = {}) {
  const text = String(query ?? '');
  if (/(วันนี้|ตอนนี้|สด|today|now|live|breaking)/iu.test(text)) return { ttlMs: 30_000, class: 'live' };
  if (/(ล่าสุด|ข่าว|ราคา|อากาศ|ช่วง\s*7\s*วัน|สัปดาห์นี้|current|latest|news|price|weather|past\s+7\s+days|this\s+week)/iu.test(text)) return { ttlMs: 120_000, class: 'current' };
  return { ttlMs: 900_000, class: 'reference', evaluatedAt: new Date(now).toISOString() };
}


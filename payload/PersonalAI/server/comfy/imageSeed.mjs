import { randomInt } from 'node:crypto';

const RANDOM_SEED_LIMIT = 2_147_483_648;

/** Normalize every caller to the integer contract expected by ComfyUI. */
export function normalizeImageSeed(value, random = () => randomInt(0, RANDOM_SEED_LIMIT)) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^\+?\d+$/.test(text)) {
      const parsed = Number(text);
      if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
    }
  }
  const generated = random();
  if (!Number.isSafeInteger(generated) || generated < 0) throw new Error('Random seed generator returned an invalid integer.');
  return generated;
}

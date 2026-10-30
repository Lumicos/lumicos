const ZERO_WIDTH = /[\u200B\u200C\u200D\uFEFF]/g;

export function normalizeKnowledgeText(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(ZERO_WIDTH, '')
    .replace(/ํา/g, 'ำ')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


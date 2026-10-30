import { createHash } from 'node:crypto';
import { normalizeKnowledgeText } from '../text/normalize.mjs';
import { keywordText } from '../text/tokens.mjs';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function splitLong(text, maxChars) {
  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  const parts = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maxChars) {
      parts.push(current);
      current = '';
    }
    if (paragraph.length > maxChars) {
      if (current) { parts.push(current); current = ''; }
      for (let offset = 0; offset < paragraph.length; offset += maxChars) {
        parts.push(paragraph.slice(offset, offset + maxChars));
      }
    } else current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current) parts.push(current);
  return parts;
}

export function chunkSections(sections, { maxChars = 1800 } = {}) {
  if (!Number.isInteger(maxChars) || maxChars < 256) throw new RangeError('maxChars must be at least 256.');
  const chunks = [];
  let documentOffset = 0;
  for (const section of sections) {
    const normalized = normalizeKnowledgeText(section.text);
    if (!normalized) continue;
    let sectionOffset = 0;
    for (const part of splitLong(normalized, maxChars)) {
      const start = documentOffset + sectionOffset;
      chunks.push({
        ordinal: chunks.length,
        content: part,
        keywordText: keywordText(part),
        page: section.page ?? null,
        heading: section.heading ?? null,
        charStart: start,
        charEnd: start + part.length,
        contentHash: sha256(part),
        metadata: section.metadata ?? {},
      });
      sectionOffset += part.length;
    }
    documentOffset += normalized.length + 2;
  }
  return chunks;
}


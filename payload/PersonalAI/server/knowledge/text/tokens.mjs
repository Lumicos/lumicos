import { normalizeKnowledgeText } from './normalize.mjs';
import { tokenize as existingThaiTokenizer } from '../../memory/text.mjs';

export function tokenizeKnowledgeText(value, locale = 'th') {
  const text = normalizeKnowledgeText(value).toLocaleLowerCase(locale);
  if (!text) return [];
  return existingThaiTokenizer(text);
}

export function keywordText(value, locale = 'th') {
  return tokenizeKnowledgeText(value, locale).join(' ');
}


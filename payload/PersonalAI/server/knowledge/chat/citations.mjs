export const CITATION_CONTRACT_VERSION = 1;

const text = (value, max = 1000) => {
  const result = String(value ?? '').replaceAll('\0', '').replace(/\s+/g, ' ').trim();
  return result ? result.slice(0, max) : undefined;
};
const integer = (value) => Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : undefined;
const webUrl = (value) => {
  try {
    const url = new URL(String(value ?? ''));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
};

// Library notes from the research agent keep "[2]" marks that point at the note's own source list. The chat model copied
// them as if they were evidence numbers (claude-20261024, real run: an answer cited "[3][2]" for a line the note had from
// [1]), so library text reaches it without them. "array[0]" and "x[1][2]" stay.
export const withoutSourceMarks = (value) => String(value ?? '').replace(/[ \t]+(?:\[\d{1,2}\])+|(?<![\w\]])(?:\[\d{1,2}\])+/g, '');

export function citationEvidence(result = {}) {
  const citations = []; const blocks = [];
  const add = (citation, content) => {
    const excerpt = String(content ?? '').replaceAll('\0', '').replace(/\r\n/g, '\n').trim();
    if (!excerpt) return;
    const id = `E${citations.length + 1}`;
    citations.push(Object.freeze({ contractVersion: CITATION_CONTRACT_VERSION, id, ...citation }));
    const fields = Object.entries(citation).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${String(value)}`);
    blocks.push(`[${id} ${fields.join(' ')}]\n${excerpt}`);
  };

  for (const item of result.local ?? []) add({
    kind: 'local', sourceId: text(item.sourceId, 160), title: text(item.displayName, 240),
    file: text(item.sourceUri, 1000), page: integer(item.page), chunk: integer(item.ordinal),
    ...(/^\d{4}-\d{2}-\d{2}/.test(String(item.modifiedAt ?? '')) ? { updatedAt: String(item.modifiedAt).slice(0, 10) } : {}),
  }, withoutSourceMarks(item.content));
  for (const item of result.web?.results ?? []) add({
    kind: 'web', sourceId: text(item.id, 160), title: text(item.title, 240), url: webUrl(item.url),
    source: text(result.web.provider, 160), publishedAt: text(item.publishedAt, 80) ?? null,
    retrievedAt: text(result.web.searchedAt, 80), fit: ['match', 'unverified'].includes(item.fit) ? item.fit : undefined,
  }, item.snippet);
  for (const item of result.memory ?? []) add({
    kind: 'memory', sourceId: text(item.memory?.id, 160),
    title: text(item.memory?.type ? `Memory · ${item.memory.type}` : 'Memory', 240),
  }, item.memory?.content);

  return { citations, evidence: blocks.join('\n\n') };
}

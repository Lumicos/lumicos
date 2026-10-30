const SECRET = /(-----BEGIN [A-Z ]+PRIVATE KEY-----|\b(?:api[_-]?key|token|password|passwd|secret)\s*[:=]|\bsk-[a-z0-9_-]{12,})/iu;
const PERSONAL = /(\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b(?:\+?66|0)\d{8,9}\b|\b\d{13}\b)/iu;
const LOCAL_CONTENT = /(file:\/\/|[a-z]:\\|\\\\|\/users\/|\/home\/|memory:\/\/|local-file:|BEGIN INTERNAL DOCUMENT)/iu;

export class QueryPrivacyError extends Error {
  constructor(reason) { super(`Web query blocked by privacy policy: ${reason}`); this.code = 'KNOWLEDGE_PRIVACY_BLOCKED'; this.status = 403; }
}

export function assertPublicWebQuery(query, context = {}) {
  if (context.private === true || context.anonymous === true) throw new QueryPrivacyError('private-or-anonymous-mode');
  const text = String(query ?? '').trim();
  if (context.containsMemory === true || context.containsLocalContent === true) throw new QueryPrivacyError('private-source-content');
  if (SECRET.test(text)) throw new QueryPrivacyError('secret-pattern');
  if (PERSONAL.test(text)) throw new QueryPrivacyError('personal-identifier');
  if (LOCAL_CONTENT.test(text)) throw new QueryPrivacyError('local-path-or-document');
  return text;
}


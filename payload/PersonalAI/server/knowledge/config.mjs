import path from 'node:path';

export const DEFAULT_KNOWLEDGE_CONFIG = Object.freeze({
  enabled: false,
  databaseFile: 'knowledge.db',
  indexing: Object.freeze({ enabled: false, maxWorkers: 1 }),
  web: Object.freeze({ enabled: false, provider: null }),
});

function boolean(value, fallback, field) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be a boolean.`);
  return value;
}

export function resolveKnowledgeConfig(input = {}, { dataDir } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('knowledge configuration must be an object.');
  }
  const indexing = input.indexing ?? {};
  const web = input.web ?? {};
  const workers = Number(indexing.maxWorkers ?? DEFAULT_KNOWLEDGE_CONFIG.indexing.maxWorkers);
  if (!Number.isInteger(workers) || workers !== 1) {
    throw new RangeError('knowledge.indexing.maxWorkers must be 1 in Gate 1.');
  }
  const databaseFile = String(input.databaseFile ?? DEFAULT_KNOWLEDGE_CONFIG.databaseFile).trim();
  if (!databaseFile || path.isAbsolute(databaseFile) || databaseFile.includes('/') || databaseFile.includes('\\')) {
    throw new TypeError('knowledge.databaseFile must be a file name inside dataDir.');
  }
  const provider = web.provider == null ? null : String(web.provider).trim();
  return Object.freeze({
    enabled: boolean(input.enabled, false, 'knowledge.enabled'),
    databaseFile,
    databasePath: dataDir ? path.join(path.resolve(dataDir), databaseFile) : databaseFile,
    indexing: Object.freeze({
      enabled: boolean(indexing.enabled, false, 'knowledge.indexing.enabled'),
      maxWorkers: workers,
    }),
    web: Object.freeze({
      enabled: boolean(web.enabled, false, 'knowledge.web.enabled'),
      provider: provider || null,
    }),
  });
}


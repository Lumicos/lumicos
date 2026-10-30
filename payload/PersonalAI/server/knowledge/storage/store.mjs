export class KnowledgeStore {
  migrate() { throw new Error('KnowledgeStore.migrate() is not implemented.'); }
  schemaVersion() { throw new Error('KnowledgeStore.schemaVersion() is not implemented.'); }
  transaction(_work) { throw new Error('KnowledgeStore.transaction() is not implemented.'); }
  close() { throw new Error('KnowledgeStore.close() is not implemented.'); }
}


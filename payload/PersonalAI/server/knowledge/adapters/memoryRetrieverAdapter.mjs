export class MemoryRetrieverAdapter {
  constructor(retriever) { this.retriever = retriever; }
  async search(request, context = {}) {
    if (context.private === true || context.anonymous === true) return [];
    return this.retriever.retrieve({ query: request.query, characterId: context.characterId ?? null,
      limit: request.limit ?? 6, maxPinned: request.maxPinned ?? 3 });
  }
}


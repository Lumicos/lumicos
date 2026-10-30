export class LocalRetrieverAdapter {
  constructor(retriever) { this.retriever = retriever; }
  search(request, context = {}) {
    if (context.private === true || context.anonymous === true) return [];
    return this.retriever.search(request.query, { workspaceId: request.workspaceId ?? 'default', limit: request.limit ?? 10, explicit: request.explicit === true, context: request.context ?? '' });
  }
}


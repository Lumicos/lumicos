export class FileServiceKnowledgeLifecycleAdapter {
  constructor({ worker, repository, workspaceId = 'default' }) {
    this.worker = worker;
    this.repository = repository;
    this.workspaceId = workspaceId;
  }

  indexFile(input) {
    return this.worker.enqueue({ ...input, workspaceId: input.workspaceId ?? this.workspaceId });
  }

  fileCreated(input) { return this.indexFile(input); }
  fileChanged(input) { return this.indexFile(input); }

  fileDeleted(sourceUri, workspaceId = this.workspaceId) {
    const source = this.repository.getByUri(sourceUri, workspaceId);
    return source ? this.repository.remove(source.id) : { removed: false, chunks: 0 };
  }
}


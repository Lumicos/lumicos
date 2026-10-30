export class Embedder {
  get profile() { throw new Error('Embedder.profile must be implemented.'); }
  async embedQuery() { throw new Error('embedQuery must be implemented.'); }
  async embedPassages() { throw new Error('embedPassages must be implemented.'); }
  async close() {}
}

export class FakeEmbedder extends Embedder {
  constructor({ dimension = 8, revision = 'test-revision' } = {}) {
    super();
    this.dimension = dimension;
    this.revision = revision;
  }
  get profile() {
    return { id: `fake-${this.dimension}-${this.revision}`, modelId: 'lumicos/fake-embedder',
      modelRevision: this.revision, runtimeName: 'fake', runtimeVersion: '1', dtype: 'int8',
      dimension: this.dimension, pooling: 'mean', normalized: true, queryPrefix: 'query: ', passagePrefix: 'passage: ' };
  }
  vector(text, prefix) {
    const out = new Float32Array(this.dimension);
    for (const [index, char] of [...`${prefix}${text}`].entries()) out[(char.codePointAt(0) + index) % this.dimension] += 1;
    let norm = Math.sqrt(out.reduce((sum, value) => sum + value * value, 0)) || 1;
    for (let i = 0; i < out.length; i++) out[i] /= norm;
    return out;
  }
  async embedQuery(text) { return this.vector(text, 'query: '); }
  async embedPassages(texts) { return texts.map((text) => this.vector(text, 'passage: ')); }
}

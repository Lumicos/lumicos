// Abstract transport interface. Protocol layer depends only on this.
// Future HTTP transport can implement the same methods.

export class Transport {
  constructor() {
    this._handlers = [];
  }

  onMessage(fn) {
    this._handlers.push(fn);
    return () => {
      const i = this._handlers.indexOf(fn);
      if (i >= 0) this._handlers.splice(i, 1);
    };
  }

  _emit(msg) {
    for (const h of this._handlers) {
      try { h(msg); } catch (e) { /* ignore handler errors */ }
    }
  }

  async start() { throw new Error('not implemented'); }
  async send(message) { throw new Error('not implemented'); }
  async close() { throw new Error('not implemented'); }

  // Optional: stderr ring buffer, pid, etc. for status
  getDiagnostics() { return {}; }
}

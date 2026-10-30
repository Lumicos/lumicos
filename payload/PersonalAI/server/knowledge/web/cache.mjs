export class TtlSearchCache {
  constructor({ maxEntries = 64, clock = () => Date.now() } = {}) { this.maxEntries = maxEntries; this.clock = clock; this.items = new Map(); }
  key(provider, request) { return JSON.stringify([provider, request.query.trim(), request.limit, request.locale ?? null]); }
  get(provider, request) {
    const key = this.key(provider, request); const item = this.items.get(key);
    if (!item || item.expiresAt <= this.clock()) { this.items.delete(key); return null; }
    return structuredClone(item.value);
  }
  set(provider, request, value, ttlMs) {
    const key = this.key(provider, request);
    if (this.items.size >= this.maxEntries && !this.items.has(key)) this.items.delete(this.items.keys().next().value);
    this.items.set(key, { expiresAt: this.clock() + ttlMs, value: structuredClone(value) });
  }
}


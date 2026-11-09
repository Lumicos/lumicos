import { randomUUID } from 'node:crypto';

const SUPPORTED_VERSIONS = new Set([
  '2024-11-05',
  '2025-03-26',
  '2025-11-25',
  '2026-07-28',
]);

const DEFAULT_VERSION = '2024-11-05';

export class ProtocolError extends Error {
  constructor(message, code = -32603, data = null) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.data = data;
  }
}

export class McpProtocol {
  constructor(transport, opts = {}) {
    this.transport = transport;
    this.clientInfo = opts.clientInfo || { name: 'selene-mcp-client', version: '0.1.0' };
    this.clientCapabilities = opts.capabilities || { tools: {} };
    this.timeoutMs = opts.timeoutMs || 30000;
    this.pending = new Map(); // id -> { resolve, reject, timer, signal }
    this.serverCapabilities = null;
    this.protocolVersion = null;
    this.serverInfo = null;
    this.initialized = false;
    this._nextId = 1;
    this._onNotification = opts.onNotification || (() => {});
    this._onListChanged = opts.onListChanged || (() => {});

    this._unsub = transport.onMessage((msg) => this._onMessage(msg));
  }

  _genId() {
    return this._nextId++;
  }

  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: DEFAULT_VERSION,
      capabilities: this.clientCapabilities,
      clientInfo: this.clientInfo,
    });
    const ver = result?.protocolVersion;
    if (!ver || !SUPPORTED_VERSIONS.has(ver)) {
      throw new ProtocolError(`Unsupported or missing protocolVersion: ${ver}`, -32602);
    }
    this.protocolVersion = ver;
    this.serverCapabilities = result.capabilities || {};
    this.serverInfo = result.serverInfo || {};
    await this.notify('notifications/initialized', {});
    this.initialized = true;
    return result;
  }

  async request(method, params = {}, signal) {
    const id = this._genId();
    const msg = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ProtocolError(`Timeout waiting for ${method}`, -32000));
      }, this.timeoutMs);

      const onAbort = () => {
        clearTimeout(timer);
        this.pending.delete(id);
        this.notify('notifications/cancelled', { requestId: id }).catch(() => {});
        reject(new ProtocolError('Request cancelled', -32800));
      };
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.pending.set(id, { resolve, reject, timer, signal, onAbort });
      this.transport.send(msg).catch((err) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  async notify(method, params = {}) {
    const msg = { jsonrpc: '2.0', method, params };
    await this.transport.send(msg);
  }

  async listTools(cursor) {
    const params = {};
    if (cursor) params.cursor = cursor;
    return this.request('tools/list', params);
  }

  async callTool(name, args, signal) {
    return this.request('tools/call', { name, arguments: args || {} }, signal);
  }

  ping() {
    return this.request('ping', {});
  }

  _onMessage(msg) {
    if (msg && msg._parseError) {
      // malformed line — log via notification channel
      this._onNotification({ method: 'internal/parseError', params: { raw: msg.raw } });
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    // Response (has id)
    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) {
        // duplicate or unknown id
        this._onNotification({ method: 'internal/unknownId', params: { id: msg.id } });
        return;
      }
      clearTimeout(p.timer);
      if (p.signal && p.onAbort) p.signal.removeEventListener('abort', p.onAbort);
      this.pending.delete(msg.id);

      if (msg.error) {
        p.reject(new ProtocolError(msg.error.message || 'RPC error', msg.error.code, msg.error.data));
      } else {
        p.resolve(msg.result);
      }
      return;
    }

    // Notification
    if (msg.method) {
      if (msg.method === 'notifications/tools/list_changed') {
        this._onListChanged(msg.params);
      }
      this._onNotification(msg);
    }
  }

  failAllPending(reason) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      if (p.signal && p.onAbort) p.signal.removeEventListener('abort', p.onAbort);
      p.reject(new ProtocolError(reason || 'Connection closed', -32000));
    }
    this.pending.clear();
  }

  close() {
    this.failAllPending('Protocol closed');
    if (this._unsub) this._unsub();
  }
}

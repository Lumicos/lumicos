import { StdioTransport } from './stdio-transport.mjs';
import { McpProtocol } from './protocol.mjs';
import { adaptTools } from './tool-adapter.mjs';
import { validateConfig } from './config.mjs';

const MAX_RESTARTS = 5;
const BASE_BACKOFF_MS = 1000;

export class McpManager {
  constructor(config, registry, opts = {}) {
    this.config = validateConfig(config);
    this.registry = registry; // ToolRegistry instance
    this.servers = new Map(); // name -> ServerState
    this.logs = [];
    this._closed = false;
    this._onStatus = opts.onStatus || (() => {});

    for (const s of this.config.servers) {
      this.servers.set(s.name, {
        config: s,
        state: 'idle', // idle | connecting | connected | failed | restarting | disabled
        tools: [],
        protocol: null,
        transport: null,
        lastError: null,
        restarts: 0,
        responseTimes: [],
        avgResponseMs: 0,
        startedAt: null,
      });
    }
  }

  _log(entry) {
    this.logs.push({ ts: Date.now(), ...entry });
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
  }

  async startAll() {
    const enabled = [...this.servers.values()].filter((s) => s.config.enabled);
    await Promise.allSettled(enabled.map((s) => this._startServer(s)));
    this._syncAllGroups();
  }

  async _startServer(state) {
    if (this._closed || !state.config.enabled) return;
    state.state = 'connecting';
    state.lastError = null;
    this._onStatus(this.status());

    const transport = new StdioTransport({
      command: state.config.command,
      args: state.config.args,
      env: state.config.env,
      cwd: state.config.cwd,
    });

    const protocol = new McpProtocol(transport, {
      timeoutMs: state.config.timeoutMs,
      onNotification: (msg) => {
        this._log({ type: 'notification', server: state.config.name, method: msg.method });
      },
      onListChanged: () => {
        this._refreshTools(state).catch(() => {});
      },
    });

    try {
      await transport.start();
      await protocol.initialize();
      state.transport = transport;
      state.protocol = protocol;
      state.state = 'connected';
      state.startedAt = Date.now();
      state.restarts = 0;
      await this._refreshTools(state);
      this._log({ type: 'connected', server: state.config.name, tools: state.tools.length });
    } catch (err) {
      const tail = transport.getDiagnostics?.()?.stderr?.slice(-3).join(' | ');
      state.lastError = tail ? `${err.message} | stderr: ${tail}` : err.message;
      state.state = 'failed';
      this._log({ type: 'connect-fail', server: state.config.name, error: err.message });
      try { await transport.close(); } catch {}
      protocol.close();
      this._scheduleRestart(state);
    }
    this._onStatus(this.status());
  }

  async _refreshTools(state) {
    if (!state.protocol) return;
    const all = [];
    let cursor;
    do {
      const res = await state.protocol.listTools(cursor);
      if (res?.tools) all.push(...res.tools);
      cursor = res?.nextCursor;
    } while (cursor);

    state.tools = adaptTools(state.config.name, all, {
      protocol: state.protocol,
      maxResultChars: state.config.maxResultChars,
      toolPolicy: state.config.toolPolicy,
      trustAnnotations: state.config.trustAnnotations,
      allowPolicyDowngrade: state.config.allowPolicyDowngrade,
      onCallLog: (e) => {
        this._log({ type: 'call', ...e });
        state.responseTimes.push(e.durationMs);
        if (state.responseTimes.length > 50) state.responseTimes.shift();
        state.avgResponseMs = Math.round(
          state.responseTimes.reduce((a, b) => a + b, 0) / state.responseTimes.length
        );
      },
    });

    // Prevent shadowing core tools — filter any that would collide
    // (registry.syncGroup already rejects if name exists outside group, but we guard here too)
    const group = `mcp-${state.config.name}`;
    this.registry.syncGroup(group, state.tools);
  }

  _scheduleRestart(state) {
    if (this._closed || state.restarts >= MAX_RESTARTS) {
      state.state = 'failed';
      this._log({ type: 'restart-exhausted', server: state.config.name });
      return;
    }
    state.restarts++;
    state.state = 'restarting';
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** (state.restarts - 1), 30000);
    this._log({ type: 'restart-scheduled', server: state.config.name, attempt: state.restarts, delay });
    clearTimeout(state.restartTimer);
    state.restartTimer = setTimeout(() => {
      state.restartTimer = null;
      if (!this._closed && state.config.enabled) this._startServer(state);
    }, delay);
    state.restartTimer.unref?.();
  }

  _syncAllGroups() {
    for (const state of this.servers.values()) {
      if (state.state === 'connected') {
        const group = `mcp-${state.config.name}`;
        this.registry.syncGroup(group, state.tools);
      }
    }
  }

  // API for upper layer: enable only specific servers for this turn (small model)
  getToolsFor(serverNames) {
    const allowed = new Set(serverNames);
    const tools = [];
    for (const state of this.servers.values()) {
      if (state.state !== 'connected') continue;
      if (allowed.size && !allowed.has(state.config.name)) continue;
      tools.push(...state.tools);
    }
    return tools;
  }

  // Sync only the requested servers into the registry (others removed from their groups)
  async activateServers(serverNames) {
    const allowed = new Set(serverNames);
    for (const state of this.servers.values()) {
      const group = `mcp-${state.config.name}`;
      if (state.state === 'connected' && allowed.has(state.config.name)) {
        this.registry.syncGroup(group, state.tools);
      } else {
        // clear the group so tools disappear
        this.registry.syncGroup(group, []);
      }
    }
  }

  status() {
    const out = {};
    for (const [name, s] of this.servers) {
      out[name] = {
        state: s.state,
        enabled: s.config.enabled,
        toolCount: s.tools.length,
        lastError: s.lastError,
        avgResponseMs: s.avgResponseMs,
        restarts: s.restarts,
        pid: s.transport?.getDiagnostics?.()?.pid,
        stderrTail: s.transport?.getDiagnostics?.()?.stderr?.slice(-5) || [],
      };
    }
    return out;
  }

  listTools() {
    const out = [];
    for (const state of this.servers.values()) {
      for (const t of state.tools) {
        out.push({
          server: state.config.name,
          name: t.name,
          originalName: t._originalName,
          description: t.description,
          permission: t.permission,
          annotations: t._annotations,
        });
      }
    }
    return out;
  }

  async close() {
    this._closed = true;
    for (const state of this.servers.values()) {
      clearTimeout(state.restartTimer);
      if (state.protocol) state.protocol.close();
      if (state.transport) {
        try { await state.transport.close(); } catch {}
      }
      state.state = 'closed';
      const group = `mcp-${state.config.name}`;
      try { this.registry.syncGroup(group, []); } catch {}
    }
  }
}

export async function createMcpManager(config, registry, opts) {
  const mgr = new McpManager(config, registry, opts);
  await mgr.startAll();
  return mgr;
}

// Starts MCP servers from data/mcp-config.json (optional). No file / no enabled servers = nothing happens.
// Never throws: a bad config or a dead server must not stop Lumicos from booting.
import fs from 'node:fs';
import { createMcpManager } from './manager.mjs';

export async function startMcpFromFile(file, registry, log = console) {
  if (!fs.existsSync(file)) return null;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { log.error?.(`[mcp] ${file} is not valid JSON: ${e.message}`); return null; }
  if (!Array.isArray(raw?.servers) || !raw.servers.some((s) => s && s.enabled !== false)) return null;
  try {
    const last = new Map();
    const onStatus = (st) => {
      for (const [name, v] of Object.entries(st || {})) {
        if (last.get(name) === v.state) continue;
        last.set(name, v.state);
        if (v.state === 'connected') log.info?.(`[mcp] ${name}: connected (${v.toolCount} tools)`);
        else if (v.state === 'failed' || v.state === 'restarting') {
          const why = [v.lastError, (v.stderrTail || []).slice(-2).join(' | ')].filter(Boolean).join(' — ');
          log.error?.(`[mcp] ${name}: ${v.state}${v.restarts ? ` (attempt ${v.restarts})` : ''}${why ? ` — ${why.slice(0, 400)}` : ''}`);
        }
      }
    };
    const mgr = await createMcpManager(raw, registry, { onStatus });
    log.info?.(`[mcp] started: ${JSON.stringify(Object.fromEntries(Object.entries(mgr.status()).map(([k, v]) => [k, v.state])))}`);
    return mgr;
  } catch (e) {
    log.error?.(`[mcp] not started: ${e.message}`);
    return null;
  }
}

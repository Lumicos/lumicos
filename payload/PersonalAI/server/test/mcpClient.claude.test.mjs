import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, ConfigError } from '../mcp/config.mjs';
import { sanitizeContent } from '../mcp/sanitize.mjs';
import { adaptTools } from '../mcp/tool-adapter.mjs';

test('mcp validateConfig accepts a minimal enabled server and rejects empty command', () => {
  const ok = validateConfig({
    servers: [{ name: 'demo', command: 'node', args: ['x.js'], enabled: true, toolPolicy: { ping: 'read' } }],
  });
  assert.equal(ok.servers.length, 1);
  assert.throws(() => validateConfig({ servers: [{ name: 'bad', command: '', enabled: true }] }), ConfigError);
});

test('mcp sanitizeContent marks tool text as untrusted and truncates', () => {
  const out = sanitizeContent([{ type: 'text', text: 'hello '.repeat(5000) }], 200);
  assert.match(out, /UNTRUSTED MCP TOOL DATA/);
  assert.ok(out.length < 500);
});

test('mcp adaptTools prefixes names and honors toolPolicy read', () => {
  const tools = adaptTools('demo', [{
    name: 'ping',
    description: 'ping',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  }], {
    protocol: { callTool: async () => ({ content: [{ type: 'text', text: 'pong' }] }) },
    maxResultChars: 1000,
    toolPolicy: { ping: 'read' },
    trustAnnotations: true,
  });
  assert.equal(tools[0].name, 'demo__ping');
  assert.equal(tools[0].permission, 'read');
});

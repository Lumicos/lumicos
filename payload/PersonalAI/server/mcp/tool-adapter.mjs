import fs from 'node:fs';
import path from 'node:path';
import { sanitizeContent, sanitizeError } from './sanitize.mjs';
import { redactArgs } from './config.mjs';

const SAFE_NAME_RE = /[^a-zA-Z0-9_]/g;

function safeName(serverName, toolName) {
  const s = String(serverName).replace(SAFE_NAME_RE, '_');
  const t = String(toolName).replace(SAFE_NAME_RE, '_');
  return `${s}__${t}`;
}

// Extract only the subset of JSON Schema that Lumicos's validateArgs understands.
// Only default type='object' at the root schema; nested untyped properties accept any JSON value.
export function toLumicosParameters(inputSchema, isRoot = true) {
  if (!inputSchema || typeof inputSchema !== 'object') {
    return isRoot ? { type: 'object', properties: {} } : {};
  }
  const out = {};
  if (inputSchema.type) out.type = inputSchema.type;
  else if (isRoot) out.type = 'object';
  if (Array.isArray(inputSchema.required)) out.required = inputSchema.required.slice();
  if (inputSchema.enum) out.enum = inputSchema.enum;
  if (typeof inputSchema.minimum === 'number') out.minimum = inputSchema.minimum;
  if (typeof inputSchema.maximum === 'number') out.maximum = inputSchema.maximum;
  if (inputSchema.items) out.items = toLumicosParameters(inputSchema.items, false);
  if (inputSchema.properties && typeof inputSchema.properties === 'object') {
    out.properties = {};
    for (const [k, v] of Object.entries(inputSchema.properties)) {
      out.properties[k] = toLumicosParameters(v, false);
    }
  }
  return out;
}

const LEVELS = { read: 0, write: 1, destructive: 2 };

export function decidePermission(annotations, policyOverride, trustAnnotations = false, allowPolicyDowngrade = false) {
  const readOnly = trustAnnotations && annotations?.readOnlyHint === true;
  const destructive = annotations?.destructiveHint === true;

  let base = 'write';
  if (destructive) base = 'destructive';
  else if (readOnly) base = 'read';

  if (policyOverride && policyOverride in LEVELS) {
    if (destructive && !allowPolicyDowngrade) return LEVELS[policyOverride] > LEVELS[base] ? policyOverride : base;
    return policyOverride;
  }
  return base;
}

// Property-path tools in EffectCraft use `path` for layer property paths (e.g. "transform.opacity"), not file paths.
const PROPERTY_PATH_TOOLS = new Set(['get_property', 'set_property', 'add_keyframe']);
const FILE_KEYS = new Set(['path', 'dir', 'destination']);

function resolveOnePath(val, ws, createParent = false) {
  if (typeof val !== 'string' || !val.trim() || !ws?.resolve) return val;
  const trimmed = val.trim();
  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:/.test(trimmed) || /^[\\/]/.test(trimmed)) return val;
  try {
    const abs = ws.resolve(trimmed).abs;
    if (createParent) fs.mkdirSync(path.dirname(abs), { recursive: true });
    return abs;
  } catch {
    return val;
  }
}

/** Resolves workspace-relative file/folder paths (e.g. "exports/out.png") to absolute workspace paths for MCP CLI servers. */
export function resolveWorkspacePaths(toolName, args, ws) {
  if (!ws?.resolve || !args || typeof args !== 'object' || Array.isArray(args)) return args;
  if (PROPERTY_PATH_TOOLS.has(toolName)) return args;
  const out = { ...args };
  const cmdId = typeof out.id === 'string' ? out.id : (typeof out.command === 'string' ? out.command : '');
  if (cmdId && /^(?:prop|keys|mask|path)\./i.test(cmdId)) return out;

  for (const k of FILE_KEYS) {
    if (typeof out[k] === 'string') {
      out[k] = resolveOnePath(out[k], ws, k !== 'path' || !/open|import/i.test(toolName + cmdId));
      if (k === 'dir' && path.isAbsolute(out[k])) try { fs.mkdirSync(out[k], { recursive: true }); } catch {}
    }
  }
  if (Array.isArray(out.paths)) {
    out.paths = out.paths.map((p) => resolveOnePath(p, ws, false));
  }
  if (out.params && typeof out.params === 'object' && !Array.isArray(out.params)) {
    out.params = resolveWorkspacePaths(cmdId || toolName, out.params, ws);
  }
  if (Array.isArray(out.steps)) {
    out.steps = out.steps.map((s) => (s && typeof s === 'object' ? resolveWorkspacePaths(s.id || toolName, s, ws) : s));
  }
  return out;
}

/** Saves any base64 image returned by an MCP preview tool into workspace/exports/ so the user/model can access the file. */
function saveInlineImages(serverName, toolName, content, ws) {
  if (!ws?.root || !Array.isArray(content)) return content;
  return content.map((item, idx) => {
    if (item && item.type === 'image' && typeof item.data === 'string' && item.data.length > 0) {
      try {
        const ext = (item.mimeType || '').includes('jpeg') ? 'jpg' : 'png';
        const rel = `exports/${serverName}-${toolName}-${Date.now().toString(36)}${idx ? '-' + idx : ''}.${ext}`;
        const abs = ws.resolve(rel).abs;
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, Buffer.from(item.data, 'base64'));
        return { type: 'text', text: JSON.stringify({ previewSaved: rel, mimeType: item.mimeType || 'image/png' }) };
      } catch {}
    }
    return item;
  });
}

function shortDesc(desc, max = 240) {
  if (!desc) return '';
  const s = String(desc).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function adaptTools(serverName, mcpTools, opts) {
  const { protocol, maxResultChars, toolPolicy, onCallLog, trustAnnotations, allowPolicyDowngrade } = opts;
  const tools = [];

  for (const t of mcpTools || []) {
    if (!t || typeof t.name !== 'string') continue;
    const name = safeName(serverName, t.name);
    const annotations = t.annotations || {};
    const policy = toolPolicy?.[t.name] ?? toolPolicy?.['*'];
    const permission = decidePermission(annotations, policy, trustAnnotations === true, allowPolicyDowngrade === true);

    const parameters = toLumicosParameters(t.inputSchema, true);
    const description = shortDesc(t.description || t.name);

    const tool = {
      name,
      description: `[${serverName}] ${description}`,
      parameters,
      permission,
      _fullSchema: t.inputSchema || null,
      _originalName: t.name,
      _server: serverName,
      _annotations: annotations,

      preview(args) {
        const redacted = redactArgs(args);
        const previewStr = JSON.stringify(redacted).slice(0, 300);
        return {
          action: `MCP ${serverName}.${t.name}`,
          detail: previewStr,
        };
      },

      async handler(args, ctx) {
        const start = Date.now();
        let status = 'ok';
        let resultLen = 0;
        try {
          const signal = ctx?.signal;
          const resolvedArgs = resolveWorkspacePaths(t.name, args, ctx?.ws);
          const result = await protocol.callTool(t.name, resolvedArgs, signal);
          const content = saveInlineImages(serverName, t.name, result?.content, ctx?.ws);
          const text = sanitizeContent(content, maxResultChars);
          resultLen = text.length;
          if (result?.isError) status = 'tool-error';
          return { content: text, isError: !!result?.isError };
        } catch (err) {
          status = 'error';
          const text = sanitizeError(err);
          resultLen = text.length;
          throw Object.assign(new Error(text), { cause: err });
        } finally {
          if (onCallLog) {
            onCallLog({
              server: serverName,
              tool: t.name,
              durationMs: Date.now() - start,
              status,
              resultLen,
            });
          }
        }
      },
    };

    tools.push(tool);
  }

  return tools;
}

// Tool registry + permission gate.
//
// Every tool has: name, description, parameters (JSON schema), permission level,
// a preview() used for confirmation/activity labels, and a handler().
//
//   read         runs automatically (inside the workspace)
//   write        runs after the user confirms (or automatically if the user allowed it)
//   destructive  ALWAYS needs an explicit confirmation
//
// Flow enforced here, independent of the UI:
//   validate(name, args)  -> permission + preview (+ approvalId for write/destructive)
//   execute(name, args, approvalId)
//     - read: runs
//     - otherwise: needs an unexpired approvalId issued for exactly these args,
//       and the permission must not have escalated since validation.
import { createHash, randomUUID } from 'node:crypto';

export class ToolError extends Error {
  constructor(message, code = 'TOOL_ERROR', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const LEVEL = { read: 0, write: 1, destructive: 2 };
const APPROVAL_TTL_MS = 10 * 60 * 1000;

/** Tiny JSON-schema subset validator: type, required, enum, items, properties, min/max. */
export function validateArgs(schema, value, where = 'arguments') {
  const t = schema.type;
  const isType = {
    object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
    array: Array.isArray,
    string: (v) => typeof v === 'string',
    number: (v) => typeof v === 'number' && Number.isFinite(v),
    integer: Number.isInteger,
    boolean: (v) => typeof v === 'boolean',
  };
  if (t && !(Array.isArray(t) ? t : [t]).some((x) => isType[x]?.(value) ?? true)) {
    throw new ToolError(`${where} must be ${Array.isArray(t) ? t.join(' or ') : t}.`, 'INVALID_ARGS');
  }
  if (schema.enum && !schema.enum.includes(value)) throw new ToolError(`${where} must be one of: ${schema.enum.join(', ')}.`, 'INVALID_ARGS');
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) throw new ToolError(`${where} must be ≥ ${schema.minimum}.`, 'INVALID_ARGS');
    if (schema.maximum != null && value > schema.maximum) throw new ToolError(`${where} must be ≤ ${schema.maximum}.`, 'INVALID_ARGS');
  }
  if (t === 'object' && isType.object(value)) {
    for (const key of schema.required ?? []) {
      if (value[key] === undefined || value[key] === null || value[key] === '') throw new ToolError(`Missing required ${where === 'arguments' ? '' : where + '.'}${key}.`, 'INVALID_ARGS');
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (value[key] !== undefined) validateArgs(sub, value[key], `${where === 'arguments' ? '' : where + '.'}${key}`);
    }
  }
  if (t === 'array' && Array.isArray(value) && schema.items) value.forEach((v, i) => validateArgs(schema.items, v, `${where}[${i}]`));
}

/** Small models often write "field": null (or "" for a pick-list field) when they mean to leave an optional field
 *  out. Treat that as omitted, then let the tool tidy its own arguments (normalizeArgs). validate() and execute()
 *  both run this, so the confirmed arguments and the executed ones always hash the same. */
export function prepareArgs(tool, args) {
  let out = args;
  if (out && typeof out === 'object' && !Array.isArray(out)) {
    out = { ...out };
    const required = new Set(tool.parameters?.required ?? []);
    for (const [key, sub] of Object.entries(tool.parameters?.properties ?? {})) {
      if (required.has(key) || !(key in out)) continue;
      const types = [].concat(sub?.type ?? []);
      const v = out[key];
      if ((v === null && !types.includes('null')) || (v === '' && Array.isArray(sub?.enum) && !sub.enum.includes(''))) delete out[key];
    }
  }
  return typeof tool.normalizeArgs === 'function' ? tool.normalizeArgs(out) : out;
}

const hashArgs = (name, args) => createHash('sha256').update(name + '\u0000' + JSON.stringify(args ?? {})).digest('hex');

export class ToolRegistry {
  constructor(ctx) {
    this.ctx = ctx;
    this.tools = new Map();
    this.approvals = new Map();
  }

  register(tool) {
    for (const k of ['name', 'description', 'parameters', 'permission', 'handler']) {
      if (!tool[k]) throw new Error(`Tool is missing "${k}".`);
    }
    if (!(tool.permission in LEVEL)) throw new Error(`Tool ${tool.name}: bad permission "${tool.permission}".`);
    this.tools.set(tool.name, tool);
    return this;
  }

  /** Atomically replace every tool of one dynamic group (e.g. protected plugins). Never shadows a
   *  static tool, never leaves duplicates; tools removed from the group become UNKNOWN_TOOL. */
  syncGroup(group, tools) {
    const names = new Set();
    for (const tool of tools) {
      for (const k of ['name', 'description', 'parameters', 'permission', 'handler']) if (!tool[k]) throw new Error(`Tool is missing "${k}".`);
      if (!(tool.permission in LEVEL)) throw new Error(`Tool ${tool.name}: bad permission "${tool.permission}".`);
      if (names.has(tool.name)) throw new Error(`Duplicate tool ${tool.name} in group ${group}.`);
      const existing = this.tools.get(tool.name);
      if (existing && existing.group !== group) throw new Error(`Tool ${tool.name} would shadow a core tool.`);
      names.add(tool.name);
    }
    for (const [name, tool] of this.tools) if (tool.group === group && !names.has(name)) this.tools.delete(name);
    for (const tool of tools) this.tools.set(tool.name, { ...tool, group });
    return this;
  }

  group(group) { return [...this.tools.values()].filter(tool => tool.group === group); }

  /** Public definitions (no handlers) for the UI / prompt. */
  definitions() {
    return [...this.tools.values()].map(({ name, description, parameters, permission, example }) => ({
      name,
      description,
      parameters,
      permission,
      example,
    }));
  }

  #get(name) {
    const canonical = /^(?:image_generator|create_image|z[ -]?image)$/i.test(name) ? 'generate_image' : name;
    const tool = this.tools.get(canonical);
    if (!tool) throw new ToolError(`Unknown tool "${name}". Available: ${[...this.tools.keys()].join(', ')}.`, 'UNKNOWN_TOOL', 404);
    return tool;
  }

  /** Base permission, possibly escalated by the tool for these args (e.g. overwriting an existing file). */
  async permissionFor(tool, args) {
    const dynamic = tool.permissionFor ? await tool.permissionFor(args, this.ctx) : tool.permission;
    return LEVEL[dynamic] > LEVEL[tool.permission] ? dynamic : tool.permission;
  }

  async validate(name, args = {}) {
    const tool = this.#get(name);
    args = prepareArgs(tool, args);
    validateArgs(tool.parameters, args);
    const permission = await this.permissionFor(tool, args);
    const preview = tool.preview ? await tool.preview(args, this.ctx) : { action: name };
    let approvalId = null;
    if (permission !== 'read') {
      this.#sweep();
      approvalId = randomUUID();
      this.approvals.set(approvalId, { hash: hashArgs(name, args), permission, expires: Date.now() + APPROVAL_TTL_MS });
    }
    return { tool: name, permission, preview, approvalId };
  }

  async execute(name, args = {}, approvalId, signal) {
    const tool = this.#get(name);
    args = prepareArgs(tool, args);
    validateArgs(tool.parameters, args);
    const permission = await this.permissionFor(tool, args);

    if (permission !== 'read') {
      const approval = approvalId && this.approvals.get(approvalId);
      if (!approval || approval.expires < Date.now()) {
        throw new ToolError(`"${name}" is a ${permission} action and needs the user's confirmation first.`, 'APPROVAL_REQUIRED', 403);
      }
      if (approval.hash !== hashArgs(name, args)) {
        throw new ToolError('The confirmed action does not match this request.', 'APPROVAL_MISMATCH', 403);
      }
      if (LEVEL[permission] > LEVEL[approval.permission]) {
        throw new ToolError(`This action became ${permission} after it was confirmed; confirm it again.`, 'APPROVAL_ESCALATED', 403);
      }
      this.approvals.delete(approvalId); // one use only
    }

    signal?.throwIfAborted();
    const result = await tool.handler(args, signal?{...this.ctx,signal}:this.ctx);
    return { tool: name, permission, ...result };
  }

  #sweep() {
    const now = Date.now();
    for (const [id, a] of this.approvals) if (a.expires < now) this.approvals.delete(id);
  }
}

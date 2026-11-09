// Config schema validation for MCP servers. Strict, reject invalid.
// Only servers listed here are allowed (allowlist).

const SECRET_FIELDS = /token|password|key|secret/i;

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function validateConfig(raw) {
  if (!isPlainObject(raw)) throw new ConfigError('Config must be an object.');
  if (!Array.isArray(raw.servers)) throw new ConfigError('Config.servers must be an array.');

  const seen = new Set();
  const servers = raw.servers.map((s, i) => {
    if (!isPlainObject(s)) throw new ConfigError(`servers[${i}] must be an object.`);
    const name = s.name;
    if (typeof name !== 'string' || !name.trim()) throw new ConfigError(`servers[${i}].name must be a non-empty string.`);
    if (seen.has(name)) throw new ConfigError(`Duplicate server name: ${name}`);
    seen.add(name);

    const command = s.command;
    if (typeof command !== 'string' || !command.trim()) throw new ConfigError(`servers[${i}].command must be a non-empty string.`);

    const args = s.args ?? [];
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
      throw new ConfigError(`servers[${i}].args must be an array of strings.`);
    }

    const env = s.env ?? {};
    if (!isPlainObject(env) || !Object.values(env).every((v) => typeof v === 'string')) {
      throw new ConfigError(`servers[${i}].env must be an object of string values.`);
    }

    const cwd = s.cwd;
    if (cwd != null && typeof cwd !== 'string') throw new ConfigError(`servers[${i}].cwd must be a string if present.`);

    const enabled = s.enabled !== false; // default true
    if (typeof s.enabled !== 'undefined' && typeof s.enabled !== 'boolean') {
      throw new ConfigError(`servers[${i}].enabled must be boolean.`);
    }

    const timeoutMs = s.timeoutMs ?? 30000;
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new ConfigError(`servers[${i}].timeoutMs must be a positive number.`);
    }

    const maxResultChars = s.maxResultChars ?? 12000;
    if (typeof maxResultChars !== 'number' || !Number.isFinite(maxResultChars) || maxResultChars <= 0) {
      throw new ConfigError(`servers[${i}].maxResultChars must be a positive number.`);
    }

    const trustAnnotations = s.trustAnnotations ?? false;
    if (typeof trustAnnotations !== 'boolean') throw new ConfigError(`servers[${i}].trustAnnotations must be boolean.`);

    const allowPolicyDowngrade = s.allowPolicyDowngrade ?? false;
    if (typeof allowPolicyDowngrade !== 'boolean') throw new ConfigError(`servers[${i}].allowPolicyDowngrade must be boolean.`);

    const toolPolicy = s.toolPolicy ?? {};
    if (!isPlainObject(toolPolicy)) throw new ConfigError(`servers[${i}].toolPolicy must be an object.`);
    const validPerms = new Set(['read', 'write', 'destructive']);
    for (const [k, v] of Object.entries(toolPolicy)) {
      if (typeof k !== 'string' || !validPerms.has(v)) {
        throw new ConfigError(`servers[${i}].toolPolicy["${k}"] must be read|write|destructive.`);
      }
    }

    return {
      name: name.trim(),
      command: command.trim(),
      args: args.slice(),
      env: { ...env },
      cwd: cwd || undefined,
      enabled,
      timeoutMs,
      maxResultChars,
      trustAnnotations,
      allowPolicyDowngrade,
      toolPolicy: { ...toolPolicy },
    };
  });

  return { servers };
}

export function isSecretField(name) {
  return SECRET_FIELDS.test(name);
}

export function redactArgs(args) {
  if (!args || typeof args !== 'object') return args;
  const out = Array.isArray(args) ? [] : {};
  for (const [k, v] of Object.entries(args)) {
    if (isSecretField(k)) out[k] = '[REDACTED]';
    else if (v && typeof v === 'object') out[k] = redactArgs(v);
    else out[k] = v;
  }
  return out;
}

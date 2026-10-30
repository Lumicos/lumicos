/**
 * ToolCallParser — finds a tool request in model output.
 *
 * Model-agnostic on purpose: small local models don't always follow a native
 * tool-calling format, so we accept several text forms:
 *
 *   ```tool
 *   {"tool": "read_file", "arguments": {"path": "notes/a.md"}}
 *   ```
 *   <tool_call>{"name": "read_file", "arguments": {...}}</tool_call>
 *   {"tool": "read_file", "arguments": {...}}          (a whole reply that is just JSON)
 *
 * Keys accepted: tool | name | function   and   arguments | args | parameters
 * (arguments may also be a JSON string). Switching LLMs only means editing this file.
 *
 * No imports on purpose, so it can be unit-tested with plain Node.
 */

export interface ParsedToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export type ParseResult =
  | { kind: 'none' }
  | { kind: 'call'; call: ParsedToolCall; before: string; raw: string }
  | { kind: 'malformed'; error: string; before: string; raw: string };

const FENCE = /```(?:tool|tool_call)\s*\n?(\{[\s\S]*?\})\s*```/i;
/** Plain or ```json fences only count when the object starts with a tool key. */
const FENCE_JSON = /```(?:json)?\s*\n?(\{\s*"(?:tool|name|function)"[\s\S]*?\})\s*```/i;
/** Gemma native text form: <|tool_call>call:name{"key":"value"}<tool_call|> */
const GEMMA = /<\|tool_call>\s*call\s*:?\s*([a-zA-Z_][\w.-]*)?\s*(\{)/g;
const TAG = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/i;
/** Where a tool block begins while streaming (used to hide it from the chat). */
const START = /<\|tool_call(?:\|>)?|```(?:tool|tool_call)\b|<tool_call>|```json\s*\n?\s*\{\s*"(?:tool|name)"/i;

function looseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Common small-model slips: trailing commas, smart quotes.
    const fixed = text
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(fixed);
  }
}

function normalise(obj: unknown): ParsedToolCall | string {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 'The tool request must be a JSON object.';
  const o = obj as Record<string, unknown>;
  const fn = o.function && typeof o.function === 'object' ? (o.function as Record<string, unknown>) : undefined;
  const tool = (o.tool ?? o.name ?? fn?.name ?? (typeof o.function === 'string' ? o.function : undefined)) as unknown;
  if (typeof tool !== 'string' || !tool.trim()) return 'The tool request needs a "tool" name.';
  let args = (o.arguments ?? o.args ?? o.parameters ?? fn?.arguments ?? {}) as unknown;
  if (typeof args === 'string') {
    try {
      args = looseJson(args);
    } catch {
      return '"arguments" is not valid JSON.';
    }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return '"arguments" must be a JSON object.';
  const requested = tool.trim();
  // Older prompts/workflows used these names. Keep one canonical registry name
  // so Gemma cannot loop on "Unknown tool" after inventing an image tool alias.
  const canonical = /^(?:image_generator|create_image|z[ -]?image|generate_image)$/i.test(requested)
    ? 'generate_image'
    : requested;
  return { tool: canonical, args: args as Record<string, unknown> };
}

/** Finds the first balanced {...} starting at `from` (handles braces inside strings). */
function balancedObject(text: string, from: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return null;
}

export function parseToolCall(text: string): ParseResult {
  const candidates: { json: string; index: number; raw: string }[] = [];

  // Fenced / tagged blocks: re-extract the object with a balanced scan so nested braces work.
  for (const re of [FENCE, FENCE_JSON, TAG]) {
    const m = re.exec(text);
    if (m) {
      const start = m.index + m[0].indexOf('{');
      const obj = balancedObject(text, start) ?? m[1];
      candidates.push({ json: obj, index: m.index, raw: m[0] });
    }
  }
  // Recognize Gemma's native tool-call text without changing older formats.
  for (const m of text.matchAll(GEMMA)) {
    const objectStart = m.index + m[0].length - 1;
    const obj = balancedObject(text, objectStart);
    if (!obj) {
      return {
        kind: 'malformed',
        error: 'Incomplete Gemma tool-call arguments.',
        before: text.slice(0, m.index).trim(),
        raw: text.slice(m.index),
      };
    }
    const end = objectStart + obj.length;
    const closing = text.slice(end).match(/^\s*(?:<tool_call\|>|<\|tool_call\|>|<\/tool_call>|<\|im_end\|>)?/);
    const raw = text.slice(m.index, end + (closing?.[0].length ?? 0));
    let args: unknown;
    try {
      args = looseJson(obj);
    } catch {
      return {
        kind: 'malformed',
        error: 'Invalid Gemma tool-call arguments.',
        before: text.slice(0, m.index).trim(),
        raw,
      };
    }
    candidates.push({
      json: JSON.stringify(m[1] ? { tool: m[1], arguments: args } : args),
      index: m.index,
      raw,
    });
  }

  // A reply that is only a JSON object.
  const trimmed = text.trim();
  if (!candidates.length && trimmed.startsWith('{') && /"(?:tool|name|function)"\s*:/.test(trimmed)) {
    const obj = balancedObject(trimmed, 0);
    if (obj) candidates.push({ json: obj, index: text.indexOf('{'), raw: obj });
  }
  if (!candidates.length) {
    const nativeStart = text.indexOf('<|tool_call>');
    if (nativeStart >= 0) return { kind: 'malformed', error: 'Incomplete or unsupported Gemma tool call.', before: text.slice(0, nativeStart).trim(), raw: text.slice(nativeStart) };
    return { kind: 'none' };
  }

  candidates.sort((a, b) => a.index - b.index);
  const first = candidates[0];
  const before = text.slice(0, first.index).trim();
  let parsed: unknown;
  try {
    parsed = looseJson(first.json);
  } catch {
    return { kind: 'malformed', error: 'The tool block is not valid JSON.', before, raw: first.raw };
  }
  const call = normalise(parsed);
  if (typeof call === 'string') return { kind: 'malformed', error: call, before, raw: first.raw };
  return { kind: 'call', call, before, raw: first.raw };
}

/** Text safe to show while streaming: everything before a (possibly partial) tool block. */
export function visibleText(text: string): string {
  const m = START.exec(text);
  let out = m ? text.slice(0, m.index) : text;
  // Hide a half-typed fence/tag at the very end ("``", "```to", "<tool_").
  out = out.replace(/(?:`{1,3}[a-z_]*|<t?o?o?l?_?c?a?l?l?)$/i, '');
  return out.trimEnd();
}

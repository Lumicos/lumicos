// Files the agent makes in the workspace (trip plans, quizzes, sales sheets: claude-20261025) and the chip that opens
// them from the chat. The chip is an attachment part with importedPath, which the chat already shows as a file with an
// "In workspace" button; assistant messages give the model only their text, so the chip never enters a prompt.
import { randomUUID } from 'node:crypto';

/** A safe file-name part: "เชียงใหม่ 3 วัน" → "เชียงใหม่-3-วัน". */
// eslint-disable-next-line no-control-regex -- control characters are not allowed in Windows file names
export const fileSlug = (text, max = 40) => String(text ?? '').replace(/[\\/:*?"<>|#[\]\x00-\x1f]+/g, ' ').replace(/\s+/g, '-')
  .replace(/^[-.]+/, '').slice(0, max).replace(/[-. ]+$/, '') || 'file';

/** Writes a new file (never overwrites: a taken name gets " (2)"). Returns {path, bytes}. */
export async function writeOut(files, rel, buf) {
  const r = await files.write(rel, buf, { mode: 'create' });
  return { path: r.path, bytes: r.bytes ?? buf.length };
}

/** The chat part that shows a made file and opens it in the workspace. */
export function fileChip({ path, bytes }) {
  const name = String(path).split('/').pop();
  return { type: 'attachment', id: `agent-${randomUUID()}`, name, size: bytes ?? 0, kind: name.includes('.') ? name.split('.').pop().toLowerCase() : 'file',
    context: '', complete: true, totalChunks: 1, importedPath: path, agentOutput: true };
}

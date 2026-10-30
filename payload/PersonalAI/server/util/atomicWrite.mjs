// Atomic JSON/text file writes that cope with Windows.
//
// On Windows, replacing a file with rename() often fails for a moment with EPERM,
// EBUSY or EACCES while antivirus or the search indexer has the file open. We retry a
// few times before giving up. The data is written to a temp file first, so the old
// file stays intact whatever happens.
import fsp from 'node:fs/promises';
import path from 'node:path';

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES', 'EAGAIN']);

export async function renameWithRetry(from, to, { tries = 6 } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fsp.rename(from, to);
    } catch (e) {
      if (!TRANSIENT.has(e.code) || i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 50 * 2 ** i)); // 50, 100, 200… ms
    }
  }
}

/** Writes `data` to `file` via a temp file. With `backup`, the previous file is kept as file.bak. */
export async function writeAtomic(file, data, { backup = false } = {}) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  if (backup) await fsp.copyFile(file, `${file}.bak`).catch((e) => (e.code === 'ENOENT' ? undefined : Promise.reject(e)));
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, data);
  await renameWithRetry(tmp, file);
}

/**
 * A write queue that keeps going after a failure: the caller of a failed write
 * gets the error, and later writes still run (a plain `q = q.then(…)` chain would
 * reject forever after one failure).
 */
export class WriteQueue {
  #tail = Promise.resolve();

  run(task) {
    const p = this.#tail.then(task);
    this.#tail = p.catch(() => {});
    return p;
  }

  /** Resolves when everything queued so far has finished (never rejects). */
  idle() {
    return this.#tail;
  }
}

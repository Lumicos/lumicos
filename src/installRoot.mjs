/** Default install folder: C:\Lumicos, with LOCALAPPDATA fallback. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_ROOT_WIN = 'C:\\Lumicos';

export function envOrFlagRoot(argv = [], env = {}) {
  const i = argv.indexOf('--root');
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1]);
  const eq = argv.find(a => a.startsWith('--root='));
  if (eq) return path.resolve(eq.slice('--root='.length));
  if (env.LUMICOS_ROOT) return path.resolve(env.LUMICOS_ROOT);
  return null;
}

/**
 * Preferred default is C:\Lumicos. If create/write fails, fall back to %LOCALAPPDATA%\Lumicos.
 * Overridable by --root / LUMICOS_ROOT. Never prompts.
 */
export async function resolveInstallRoot(argv = [], env = {}, {tryCreate = true, platform = process.platform} = {}) {
  const forced = envOrFlagRoot(argv, env);
  if (forced) return {root: forced, fallbackUsed: false};

  const preferred = DEFAULT_ROOT_WIN;
  const localApp = env.LOCALAPPDATA || env.HOME || os.tmpdir();
  const fallback = path.join(localApp, 'Lumicos');

  if (platform !== 'win32') {
    // Plans still advertise the Windows default; installs on non-Windows CI use a writable fallback.
    if (!tryCreate) return {root: preferred, fallbackUsed: false};
    return {
      root: fallback,
      fallbackUsed: true,
      message: `Non-Windows host: using ${fallback} (Windows default is ${preferred}).`,
    };
  }

  if (!tryCreate) return {root: preferred, fallbackUsed: false};

  try {
    await fs.mkdir(preferred, {recursive: true});
    const probe = path.join(preferred, '.lumicos-write-test');
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
    return {root: preferred, fallbackUsed: false};
  } catch (e) {
    return {
      root: fallback,
      fallbackUsed: true,
      message: `Cannot create or write ${preferred} (${e.message}). Falling back to ${fallback}. / สร้าง ${preferred} ไม่ได้ — ใช้ ${fallback} แทน`,
    };
  }
}

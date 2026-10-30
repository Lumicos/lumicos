import fs from 'node:fs';
import path from 'node:path';

/**
 * On Windows a venv's Scripts\python.exe is only a launcher: it starts the base interpreter as a
 * child, and that child opens its own console window even when Node spawns with windowsHide.
 * Launch the base interpreter directly instead and give it the same `__PYVENV_LAUNCHER__` hint the
 * launcher would, so it still runs inside the venv (same sys.prefix and site-packages) and the
 * stdio pipes reach the real process. Anything that is not a recognisable venv is returned unchanged.
 * @returns {{command:string, env:Record<string,string>}}
 */
export function pythonLaunch(exe) {
  const plain = { command: exe, env: {} };
  if (process.platform !== 'win32' || !exe || !/[\\/]Scripts[\\/]pythonw?\.exe$/i.test(exe)) return plain;
  try {
    const cfg = fs.readFileSync(path.join(path.dirname(path.dirname(exe)), 'pyvenv.cfg'), 'utf8');
    const value = (key) => cfg.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'mi'))?.[1];
    const base = value('executable') || (value('home') && path.join(value('home'), 'python.exe'));
    if (!base || !fs.existsSync(base)) return plain;
    return { command: base, env: { __PYVENV_LAUNCHER__: path.resolve(exe) } };
  } catch { return plain; }
}

/** Backwards-compatible name: the executable to spawn (env hint is dropped — prefer pythonLaunch). */
export function hiddenPython(exe) { return exe; }

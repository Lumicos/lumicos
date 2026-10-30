"""Lumicos sandbox runner. Runs ONE snippet of Python inside the AppContainer.

Usage: python run.py <run_dir>
  <run_dir>/code.py      the code to run (written by the Lumicos backend)
  <run_dir>/stdout.txt   everything printed
  <run_dir>/stderr.txt   errors / tracebacks
The working directory is Lumicos's workspace, so relative paths like
"exports/chart.png" land next to the files the file tools see.
"""
import os
import site
import sys
import traceback

RUN_DIR = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USER_PACKAGES = os.path.join(ROOT, 'user-packages')

for extra in (os.path.join(ROOT, 'site-packages'), USER_PACKAGES):
    if os.path.isdir(extra):
        site.addsitedir(extra)

out = open(os.path.join(RUN_DIR, 'stdout.txt'), 'w', encoding='utf-8', buffering=1)
err = open(os.path.join(RUN_DIR, 'stderr.txt'), 'w', encoding='utf-8', buffering=1)
sys.stdout, sys.stderr = out, err
os.environ.setdefault('MPLBACKEND', 'Agg')


def pip_install(*packages):
    """Install extra packages into the sandbox (kept for later runs)."""
    import subprocess
    cmd = [sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check',
           '--no-warn-script-location', '--target', USER_PACKAGES, *packages]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    tail = (proc.stdout + proc.stderr).strip().splitlines()[-5:]
    print('\n'.join(tail))
    if proc.returncode != 0:
        raise RuntimeError('pip install failed: ' + ' '.join(packages))
    importlib_invalidate()


def importlib_invalidate():
    import importlib
    importlib.invalidate_caches()
    if USER_PACKAGES not in sys.path:
        site.addsitedir(USER_PACKAGES)


def main():
    with open(os.path.join(RUN_DIR, 'code.py'), encoding='utf-8') as f:
        source = f.read()
    scope = {'__name__': '__main__', '__file__': 'lumicos_code.py', 'pip_install': pip_install}
    try:
        exec(compile(source, 'lumicos_code.py', 'exec'), scope)
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
        return code
    except BaseException:
        # Show only the user's frames, not this runner.
        etype, value, tb = sys.exc_info()
        while tb is not None and tb.tb_frame.f_code.co_filename != 'lumicos_code.py':
            tb = tb.tb_next
        traceback.print_exception(etype, value, tb)
        return 1
    finally:
        try:
            import matplotlib.pyplot as plt  # noqa: close figures so files flush
            plt.close('all')
        except Exception:
            pass
    return 0


if __name__ == '__main__':
    status = main()
    out.flush(); err.flush()
    os._exit(status)

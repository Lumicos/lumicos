import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {resolveSearchPaths, INSTALL_ROOT} = await import(pathToFileURL(path.resolve('payload/PersonalAI/server/web/searchV6Service.mjs')).href);

test('search paths prefer options, then env, then install-root siblings over C:/AI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumicos-search-paths-'));
  try {
    const mcp = path.join(dir, 'LumicosSearchMCP');
    fs.mkdirSync(mcp);
    fs.writeFileSync(path.join(mcp, 'bridge.py'), '# test');
    const envFile = { LUMICOS_SEARCH_DIR: 'D:/from-env-file/LumicosSearchMCP', LUMICOS_SEARCH_PYTHON: 'D:/from-env-file/python.exe' };
    fs.writeFileSync(path.join(dir, 'environment.json'), JSON.stringify(envFile));
    assert.deepEqual(
      resolveSearchPaths({ root: 'X:/explicit/mcp', python: 'X:/explicit/python.exe', installRoot: dir }, {}),
      { root: 'X:/explicit/mcp', python: 'X:/explicit/python.exe' },
    );
    assert.deepEqual(
      resolveSearchPaths({ installRoot: dir }, { LUMICOS_SEARCH_DIR: 'E:/process/mcp', LUMICOS_SEARCH_PYTHON: 'E:/process/python.exe' }),
      { root: 'E:/process/mcp', python: 'E:/process/python.exe' },
    );
    assert.deepEqual(resolveSearchPaths({ installRoot: dir }, {}), {
      root: 'D:/from-env-file/LumicosSearchMCP',
      python: 'D:/from-env-file/python.exe',
    });
    fs.unlinkSync(path.join(dir, 'environment.json'));
    const sibling = resolveSearchPaths({ installRoot: dir }, {});
    assert.equal(sibling.root, mcp);
    assert.equal(sibling.python, path.join(dir, 'Lumicos-Sandbox', 'python', 'python.exe'));
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lumicos-search-empty-'));
    try {
      assert.deepEqual(resolveSearchPaths({ installRoot: empty }, {}), {
        root: 'C:/AI/LumicosSearchMCP',
        python: 'C:/AI/Lumicos-Sandbox/python/python.exe',
      });
    } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('repo payload layout resolves Search MCP beside PersonalAI without C:/AI defaults', () => {
  const paths = resolveSearchPaths({ installRoot: INSTALL_ROOT }, {});
  assert.equal(paths.root, path.join(INSTALL_ROOT, 'LumicosSearchMCP'));
  assert.equal(paths.python, path.join(INSTALL_ROOT, 'Lumicos-Sandbox', 'python', 'python.exe'));
  assert.notEqual(paths.root, 'C:/AI/LumicosSearchMCP');
});

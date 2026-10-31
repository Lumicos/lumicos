import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {resolveSandboxRoot, INSTALL_ROOT} = await import(pathToFileURL(path.resolve('payload/PersonalAI/server/sandbox/sandboxService.mjs')).href);

test('sandbox root prefers env, then environment.json, then sibling Lumicos-Sandbox over C:/AI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumicos-sandbox-paths-'));
  try {
    const box = path.join(dir, 'Lumicos-Sandbox');
    fs.mkdirSync(path.join(box, 'python'), { recursive: true });
    fs.writeFileSync(path.join(box, 'python', 'python.exe'), '');
    fs.writeFileSync(path.join(dir, 'environment.json'), JSON.stringify({ LUMICOS_SANDBOX_ROOT: 'D:/from-env-file/Lumicos-Sandbox' }));
    assert.equal(resolveSandboxRoot({ LUMICOS_SANDBOX_ROOT: 'E:/process/sandbox' }, dir), 'E:/process/sandbox');
    assert.equal(resolveSandboxRoot({}, dir), 'D:/from-env-file/Lumicos-Sandbox');
    fs.unlinkSync(path.join(dir, 'environment.json'));
    assert.equal(resolveSandboxRoot({}, dir), box);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lumicos-sandbox-empty-'));
    try {
      assert.equal(resolveSandboxRoot({}, empty), 'C:\\AI\\Lumicos-Sandbox');
    } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('repo payload layout resolves Lumicos-Sandbox beside PersonalAI without C:/AI defaults', () => {
  // payload/ contains Lumicos-Sandbox/python/python.exe in the public tree
  const root = resolveSandboxRoot({}, INSTALL_ROOT);
  assert.equal(root, path.join(INSTALL_ROOT, 'Lumicos-Sandbox'));
  assert.notEqual(root, 'C:\\AI\\Lumicos-Sandbox');
});

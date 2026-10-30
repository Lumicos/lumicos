// claude-20261015 step 1: build identity shared by backend and page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceBuildId } from '../util/buildInfo.mjs';

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumicos-build-'));
  fs.mkdirSync(path.join(root, 'src', 'a'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a', 'x.ts'), 'export const x = 1;');
  fs.writeFileSync(path.join(root, 'src', 'main.tsx'), 'console.log(1)');
  return root;
}

test('same sources give the same id; editing a source changes it', () => {
  const root = tmpProject();
  const a = sourceBuildId(root);
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(sourceBuildId(root), a);
  fs.writeFileSync(path.join(root, 'src', 'a', 'x.ts'), 'export const x = 2;');
  assert.notEqual(sourceBuildId(root), a);
});

test('tests and backup files do not change the id; a missing src/ gives "unknown"', () => {
  const root = tmpProject();
  const a = sourceBuildId(root);
  fs.writeFileSync(path.join(root, 'src', 'a', 'x.test.mjs'), 'nothing');
  fs.writeFileSync(path.join(root, 'src', 'a', 'x.ts.bak-20261015'), 'old');
  assert.equal(sourceBuildId(root), a);
  assert.equal(sourceBuildId(path.join(root, 'nope')), 'unknown');
});

test('the real project id is stable across two calls', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  assert.equal(sourceBuildId(root), sourceBuildId(root));
});

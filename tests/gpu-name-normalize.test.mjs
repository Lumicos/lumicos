import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** Same rules as Normalize-GpuName in src/detect.ps1 (keep in sync). */
export function normalizeGpuName(n) {
  return String(n ?? '')
    .replace(/NVIDIA( Corporation)?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

test('detect.ps1 still defines Normalize-GpuName used for nvidia-smi overlay', () => {
  const src = fs.readFileSync(path.resolve('src/detect.ps1'), 'utf8');
  assert.match(src, /function Normalize-GpuName/);
  assert.match(src, /nvidia-smi/);
  assert.match(src, /Normalize-GpuName \$g\.name/);
});

test('normalized Win32 and nvidia-smi names match when prefixes differ', () => {
  const cases = [
    ['NVIDIA GeForce RTX 4070', 'GeForce RTX 4070'],
    ['NVIDIA Corporation GeForce RTX 4090', 'GeForce RTX 4090'],
    ['GeForce RTX 3060', 'GeForce RTX 3060'],
    ['NVIDIA GeForce RTX 5090 Laptop GPU', 'GeForce RTX 5090 Laptop GPU'],
  ];
  for (const [a, b] of cases) {
    assert.equal(normalizeGpuName(a), normalizeGpuName(b), `${a} vs ${b}`);
  }
  assert.notEqual(normalizeGpuName('GeForce RTX 4070'), normalizeGpuName('GeForce RTX 4080'));
});

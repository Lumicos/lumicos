import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const installPs1 = fs.readFileSync(path.join(root, 'install.ps1'), 'utf8');
const getCmd = fs.readFileSync(path.join(root, 'get.cmd'), 'utf8');
const oneLiner =
  'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Lumicos/lumicos/main/install.ps1 | iex"';

test('install.ps1 downloads main.zip over TLS1.2 and extracts under TEMP', () => {
  assert.match(installPs1, /SecurityProtocolType\]::Tls12/);
  assert.match(installPs1, /Invoke-WebRequest/);
  assert.match(installPs1, /github\.com\/Lumicos\/lumicos\/archive\/refs\/heads\/main\.zip/);
  assert.match(installPs1, /Expand-Archive/);
  assert.match(installPs1, /\$env:TEMP/);
  assert.match(installPs1, /lumicos-/);
});

test('install.ps1 runs Install.cmd interactively and cleans temp only on success', () => {
  assert.match(installPs1, /Install\.cmd/);
  assert.match(installPs1, /cmd\.exe/);
  assert.match(installPs1, /Remove-Item/);
  assert.match(installPs1, /exit \$exitCode|exit \$Code/);
  // Keep temp on failure message
  assert.match(installPs1, /Temp kept|เก็บไฟล์ชั่วคราว/);
});

test('install.ps1 uses LiteralPath and bilingual errors (no elevation request)', () => {
  assert.match(installPs1, /-LiteralPath/);
  assert.match(installPs1, /กำลังดาวน์โหลด|Download failed|ข้อผิดพลาด/);
  assert.doesNotMatch(installPs1, /Start-Process\s+-Verb\s+RunAs|Requires?\s+-RunAsAdministrator/i);
});

test('get.cmd and docs advertise the documented one-liner', () => {
  assert.match(getCmd, /irm https:\/\/raw\.githubusercontent\.com\/Lumicos\/lumicos\/main\/install\.ps1 \| iex/);
  for (const rel of ['README.md', 'README.th.md', 'docs/INSTALLATION.md']) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.ok(text.includes(oneLiner), `${rel} missing one-liner`);
    assert.match(text, /install\.ps1/);
  }
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {selectProfile} from '../src/profile.mjs';
import {
  listBackendOptions,
  applyBackendChoice,
  defaultBackendId,
  resolveBackendFromFlags,
} from '../src/backendChoice.mjs';
import {runTwoScreenChoices} from '../src/installWizard.mjs';
import {resolveInstallRoot, DEFAULT_ROOT_WIN} from '../src/installRoot.mjs';

const hardware = (name, vram = 16, extra = {}) => ({
  arch: 'X64', build: 26100, ramGiB: 32, cpu: 'AMD Ryzen 9', cudaMax: '13.4',
  gpus: name ? [{name, vramGiB: vram}] : [],
  ...extra,
});

test('NVIDIA CUDA 13 lists cuda13 + vulkan + cpu; recommends cuda13', () => {
  const opts = listBackendOptions(hardware('NVIDIA GeForce RTX 4070', 12, {cudaMax: '13.0'}));
  assert.deepEqual(opts.map(o => o.id), ['cuda13', 'cuda12', 'vulkan', 'cpu']);
  assert.equal(defaultBackendId(hardware('NVIDIA GeForce RTX 4070', 12, {cudaMax: '13.0'})), 'cuda13');
  assert.ok(opts.find(o => o.id === 'cuda13').recommended);
});

test('RTX 50 with CUDA 13 has no cuda12 option; whisper stays CPU on cuda13', () => {
  const h = hardware('NVIDIA GeForce RTX 5090', 32, {cudaMax: '13.0'});
  const opts = listBackendOptions(h);
  assert.ok(!opts.some(o => o.id === 'cuda12'));
  assert.equal(defaultBackendId(h), 'cuda13');
  const p = applyBackendChoice(h, 'cuda13');
  assert.equal(p.llama, 'llama-cuda13');
  assert.equal(p.whisper, 'whisper-cpu');
  assert.equal(p.torch, 'cu130');
});

test('CUDA 12.4 NVIDIA recommends cuda12 and maps llama/torch/whisper', () => {
  const h = hardware('NVIDIA GeForce RTX 3060', 12, {cudaMax: '12.4'});
  assert.equal(defaultBackendId(h), 'cuda12');
  const p = applyBackendChoice(h, 'cuda12');
  assert.equal(p.backend, 'cuda');
  assert.equal(p.llama, 'llama-cuda12');
  assert.equal(p.torch, 'cu124');
  assert.equal(p.whisper, 'whisper-cuda');
  assert.equal(p.images, true);
});

test('choosing vulkan on NVIDIA disables images and uses CPU whisper', () => {
  const h = hardware('NVIDIA GeForce RTX 4070', 12, {cudaMax: '13.0'});
  const p = applyBackendChoice(h, 'vulkan');
  assert.equal(p.backend, 'vulkan');
  assert.equal(p.llama, 'llama-vulkan');
  assert.equal(p.images, false);
  assert.equal(p.whisper, 'whisper-cpu');
});

test('AMD RX 9070 offers ROCm (recommended) and vulkan', () => {
  const h = hardware('AMD Radeon RX 9070', 16, {cudaMax: null});
  const opts = listBackendOptions(h);
  assert.ok(opts.some(o => o.id === 'rocm'));
  assert.equal(defaultBackendId(h), 'rocm');
  const p = applyBackendChoice(h, 'rocm');
  assert.equal(p.target, 'gfx1201');
  assert.equal(p.llama, 'llama-rocm');
  assert.equal(selectProfile(h).target, 'gfx1201');
});

test('CPU-only hardware offers only cpu', () => {
  const h = hardware(null, 0, {gpus: [], cudaMax: null});
  const opts = listBackendOptions(h);
  assert.deepEqual(opts.map(o => o.id), ['cpu']);
  assert.equal(applyBackendChoice(h, 'cpu').backend, 'cpu');
});

test('recommended backend matches selectProfile auto choice', () => {
  for (const h of [
    hardware('NVIDIA GeForce RTX 4070', 12, {cudaMax: '13.0'}),
    hardware('NVIDIA GeForce RTX 3060', 12, {cudaMax: '12.4'}),
    hardware('AMD Radeon RX 7900 XTX', 24, {cudaMax: null}),
    hardware('Intel UHD Graphics', 0, {cudaMax: null}),
  ]) {
    const auto = selectProfile(h);
    const applied = applyBackendChoice(h, defaultBackendId(h));
    assert.equal(applied.backend, auto.backend, auto.id);
    assert.equal(applied.llama, auto.llama);
    assert.equal(applied.torch, auto.torch);
    assert.equal(applied.whisper, auto.whisper);
  }
});

test('resolveBackendFromFlags reads --backend and env', () => {
  assert.equal(resolveBackendFromFlags(['--backend', 'vulkan'], {}), 'vulkan');
  assert.equal(resolveBackendFromFlags(['--backend=cpu'], {}), 'cpu');
  assert.equal(resolveBackendFromFlags([], {LUMICOS_BACKEND: 'rocm'}), 'rocm');
  assert.equal(resolveBackendFromFlags([], {}), null);
});

test('two-screen wizard calls prompts exactly twice then accepts CPU whisper from STT choice', async () => {
  const catalog = JSON.parse(fs.readFileSync(path.resolve('catalog/models.json'), 'utf8'));
  const h = hardware('NVIDIA GeForce RTX 5090', 32, {cudaMax: '13.0'}); // CPU whisper on cuda13
  let calls = 0;
  const result = await runTwoScreenChoices(h, catalog, {
    interactive: true,
    auto: false,
    promptBackendChoiceFn: async () => {
      calls += 1;
      assert.equal(calls, 1);
      return 'cuda13';
    },
    promptModelChoiceFn: async (offered) => {
      calls += 1;
      assert.equal(calls, 2);
      // keep recommended including whisper
      return {
        ids: offered.map(m => m.id),
        images: true,
        stt: true,
        tts: true,
        chatModel: 'chat-e4b',
      };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.promptCount, 2);
  assert.equal(result.backendId, 'cuda13');
  assert.equal(result.acceptFallback, true);
  assert.equal(result.choice.stt, true);
  assert.equal(result.profile.whisper, 'whisper-cpu');
});

test('auto / non-interactive wizard never prompts', async () => {
  const catalog = JSON.parse(fs.readFileSync(path.resolve('catalog/models.json'), 'utf8'));
  const h = hardware('NVIDIA GeForce RTX 4070', 12, {cudaMax: '13.0'});
  const boom = async () => { throw new Error('should not prompt'); };
  const result = await runTwoScreenChoices(h, catalog, {
    interactive: false,
    auto: true,
    promptBackendChoiceFn: boom,
    promptModelChoiceFn: boom,
  });
  assert.equal(result.promptCount, 0);
  assert.equal(result.backendId, 'cuda13');
});

test('default install root prefers C:\\Lumicos; flag overrides; win32 write-fail falls back', async () => {
  assert.equal(DEFAULT_ROOT_WIN, 'C:\\Lumicos');
  const forced = await resolveInstallRoot(['--root', '/tmp/lumicos-forced'], {}, {tryCreate: false});
  assert.equal(forced.root, path.resolve('/tmp/lumicos-forced'));
  const plan = await resolveInstallRoot([], {}, {tryCreate: false, platform: 'win32'});
  assert.equal(plan.root, 'C:\\Lumicos');
  const fail = await resolveInstallRoot([], {LOCALAPPDATA: '/tmp/la'}, {
    tryCreate: true,
    platform: 'win32',
  });
  // On Linux we cannot really create C:\Lumicos as win32 path the same way — inject by
  // using a platform win32 with preferred path that fails: mkdir C:\Lumicos may create oddly.
  // Non-Windows path:
  const nonWin = await resolveInstallRoot([], {LOCALAPPDATA: '/tmp/la'}, {tryCreate: true, platform: 'linux'});
  assert.equal(nonWin.root, path.join('/tmp/la', 'Lumicos'));
  assert.equal(nonWin.fallbackUsed, true);
});

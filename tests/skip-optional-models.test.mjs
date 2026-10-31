import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  offeredModels,
  resolveModelChoiceFromFlags,
  applyModelChoice,
  reconcileCpuWhisper,
  choiceEnables,
  selectedModels,
  finalizeChoice,
} from '../src/modelChoice.mjs';
import {configure} from '../src/configure.mjs';
import {readJson} from '../src/io.mjs';

const catalog = [
  {id: 'call-e2b', group: 'chat', files: [{name: 'a.gguf', destination: 'models/chat/a.gguf', sha256: 'x'}]},
  {id: 'chat-e4b', group: 'chat', files: []},
  {id: 'whisper', group: 'stt', files: [{name: 'w.bin', destination: 'models/whisper/w.bin', sha256: 'y'}]},
  {id: 'image', group: 'image', files: []},
];
const cpuWhisperProfile = {
  chatModel: 'call-e2b',
  voice: true,
  images: true,
  whisper: 'whisper-cpu',
  backend: 'cpu',
  context: 4096,
  ngl: 0,
};

test('declining STT via flags never enables Whisper download or LUMICOS_STT', async () => {
  const offered = offeredModels(catalog, cpuWhisperProfile);
  const choice = resolveModelChoiceFromFlags(
    ['--yes', '--skip-stt', '--skip-tts', '--skip-images'],
    {},
    offered,
    cpuWhisperProfile,
  );
  assert.equal(choice.stt, false);
  assert.equal(choice.tts, false);
  assert.equal(choice.images, false);
  const profile = applyModelChoice(cpuWhisperProfile, choice);
  assert.equal(choiceEnables(profile, 'stt'), false);
  assert.deepEqual(selectedModels(catalog, profile).map(m => m.id), ['call-e2b']);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumicos-skip-'));
  try {
    await configure(dir, profile);
    const env = await readJson(path.join(dir, 'environment.json'));
    assert.equal(env.LUMICOS_STT, 'off');
    assert.equal(env.LUMICOS_TTS, 'off');
    assert.equal(env.LUMICOS_IMAGES, 'off');
  } finally {
    await fs.rm(dir, {recursive: true, force: true});
  }
});

test('CPU Whisper without accept drops STT and continues (no abort)', () => {
  const offered = offeredModels(catalog, cpuWhisperProfile);
  const kept = resolveModelChoiceFromFlags(['--yes'], {}, offered, cpuWhisperProfile);
  assert.equal(kept.stt, true);
  const {choice, acceptFallback, droppedStt} = reconcileCpuWhisper(offered, cpuWhisperProfile, kept, {
    acceptCpuWhisper: false,
    dropStt: true,
  });
  assert.equal(droppedStt, true);
  assert.equal(acceptFallback, false);
  assert.equal(choice.stt, false);
  assert.ok(!choice.ids.includes('whisper'));
  const profile = applyModelChoice(cpuWhisperProfile, choice);
  assert.equal(choiceEnables(profile, 'stt'), false);
});

test('CPU Whisper with accept keeps STT', () => {
  const offered = offeredModels(catalog, cpuWhisperProfile);
  const kept = resolveModelChoiceFromFlags(['--yes'], {}, offered, cpuWhisperProfile);
  const {choice, acceptFallback, droppedStt} = reconcileCpuWhisper(offered, cpuWhisperProfile, kept, {
    acceptCpuWhisper: true,
    dropStt: false,
  });
  assert.equal(droppedStt, undefined);
  assert.equal(acceptFallback, true);
  assert.equal(choice.stt, true);
});

test('menu selection without Whisper produces STT-off configure env', async () => {
  const offered = offeredModels(catalog, cpuWhisperProfile);
  const choice = finalizeChoice(offered, cpuWhisperProfile, ['call-e2b', 'tts']);
  assert.equal(choice.stt, false);
  assert.equal(choice.tts, true);
  const profile = applyModelChoice(cpuWhisperProfile, choice);
  assert.equal(choiceEnables(profile, 'stt'), false);
  assert.equal(choiceEnables(profile, 'tts'), true);
  assert.ok(!selectedModels(catalog, profile).some(m => m.group === 'stt'));

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumicos-skip-stt-'));
  try {
    await configure(dir, profile);
    const env = await readJson(path.join(dir, 'environment.json'));
    assert.equal(env.LUMICOS_STT, 'off');
    assert.equal(env.LUMICOS_TTS, 'on');
  } finally {
    await fs.rm(dir, {recursive: true, force: true});
  }
});

test('Bootstrap.ps1 no longer throws when CPU Whisper is declined before the menu', async () => {
  const text = await fs.readFile(new URL('../Bootstrap.ps1', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /CPU Whisper fallback was not accepted/);
  assert.doesNotMatch(text, /Type YES/);
  assert.match(text, /skip-stt|SkipStt/i);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  offeredModels,
  defaultModelIds,
  resolveModelChoiceFromFlags,
  finalizeChoice,
  applyModelChoice,
  selectedModels,
  promptModelChoice,
  choiceEnables,
} from '../src/modelChoice.mjs';

const catalog = [
  {id: 'call-e2b', group: 'chat', files: []},
  {id: 'chat-e4b', group: 'chat', files: []},
  {id: 'whisper', group: 'stt', files: []},
  {id: 'image', group: 'image', files: []},
];
const gpuProfile = {chatModel: 'chat-e4b', voice: true, images: true};
const docsProfile = {chatModel: 'call-e2b', voice: true, images: false};

test('offered models include chat, STT, virtual TTS, and Image Lab', () => {
  const full = offeredModels(catalog, gpuProfile).map(m => m.id);
  assert.deepEqual(full, ['call-e2b', 'chat-e4b', 'whisper', 'tts', 'image']);
  const docs = offeredModels(catalog, docsProfile).map(m => m.id);
  assert.deepEqual(docs, ['call-e2b', 'chat-e4b', 'whisper', 'tts']);
});

test('--yes keeps recommended defaults including Image Lab / STT / TTS', () => {
  const offered = offeredModels(catalog, gpuProfile);
  const choice = resolveModelChoiceFromFlags(['--yes'], {}, offered, gpuProfile);
  assert.ok(choice.ids.includes('call-e2b'));
  assert.ok(choice.ids.includes('chat-e4b'));
  assert.ok(choice.ids.includes('whisper'));
  assert.ok(choice.ids.includes('tts'));
  assert.ok(choice.ids.includes('image'));
  assert.equal(choice.images, true);
  assert.equal(choice.stt, true);
  assert.equal(choice.tts, true);
});

test('--skip-images / --skip-stt / --skip-tts omit features and continue', () => {
  const offered = offeredModels(catalog, gpuProfile);
  const a = resolveModelChoiceFromFlags(['--yes', '--skip-images'], {}, offered, gpuProfile);
  assert.equal(a.images, false);
  assert.ok(!a.ids.includes('image'));
  const b = resolveModelChoiceFromFlags(['--yes', '--skip-stt'], {}, offered, gpuProfile);
  assert.equal(b.stt, false);
  assert.ok(!b.ids.includes('whisper'));
  const c = resolveModelChoiceFromFlags(['--yes', '--skip-tts'], {}, offered, gpuProfile);
  assert.equal(c.tts, false);
  assert.ok(!c.ids.includes('tts'));
  const d = resolveModelChoiceFromFlags(['--yes'], {LUMICOS_SKIP_IMAGES: '1', LUMICOS_SKIP_STT: '1'}, offered, gpuProfile);
  assert.equal(d.images, false);
  assert.equal(d.stt, false);
});

test('--models list and LUMICOS_MODELS select an explicit subset', () => {
  const offered = offeredModels(catalog, gpuProfile);
  const a = resolveModelChoiceFromFlags(['--models', 'call-e2b,whisper'], {}, offered, gpuProfile);
  assert.deepEqual(a.ids.sort(), ['call-e2b', 'whisper']);
  assert.equal(a.images, false);
  assert.equal(a.stt, true);
  assert.equal(a.tts, false);
  const b = resolveModelChoiceFromFlags([], {LUMICOS_MODELS: 'call-e2b,image,tts'}, offered, gpuProfile);
  assert.ok(b.ids.includes('image'));
  assert.ok(b.ids.includes('tts'));
  assert.equal(b.images, true);
  assert.equal(b.tts, true);
});

test('declining every chat model still keeps one chat model so install can continue', () => {
  const offered = offeredModels(catalog, gpuProfile);
  const choice = finalizeChoice(offered, gpuProfile, ['whisper']);
  assert.ok(choice.ids.includes('call-e2b') || choice.ids.some(id => catalog.find(m => m.id === id)?.group === 'chat'));
  assert.equal(choice.images, false);
});

test('applyModelChoice turns off images/stt/tts without aborting', () => {
  const offered = offeredModels(catalog, gpuProfile);
  const choice = resolveModelChoiceFromFlags(['--yes', '--skip-images', '--skip-stt', '--skip-tts'], {}, offered, gpuProfile);
  const p = applyModelChoice(gpuProfile, choice);
  assert.equal(p.images, false);
  assert.equal(p.voice, false);
  assert.ok(p.modelChoice);
  assert.equal(choiceEnables(p, 'stt'), false);
  assert.equal(choiceEnables(p, 'tts'), false);
});

test('selectedModels respects persisted modelChoice ids and excludes virtual TTS from catalog', () => {
  const p = applyModelChoice(gpuProfile, {ids: ['call-e2b', 'tts'], images: false, stt: false, tts: true, chatModel: 'call-e2b'});
  assert.deepEqual(selectedModels(catalog, p).map(m => m.id), ['call-e2b']);
});

test('menu fallback answering with numbers skips declined models', async () => {
  const offered = offeredModels(catalog, gpuProfile);
  // Defaults are all recommended; pick only E2B + Whisper (1 and 3).
  const choice = await promptModelChoice(offered, gpuProfile, {
    askFn: async () => '1,3',
  });
  assert.ok(choice.ids.includes('call-e2b'));
  assert.ok(choice.ids.includes('whisper'));
  assert.ok(!choice.ids.includes('chat-e4b'));
  assert.ok(!choice.ids.includes('image'));
  assert.ok(!choice.ids.includes('tts'));
  assert.equal(choice.images, false);
  assert.equal(choice.stt, true);
  assert.equal(choice.tts, false);
});

test('defaultModelIds for docs-focused (no images) never includes image', () => {
  const offered = offeredModels(catalog, docsProfile);
  assert.ok(!defaultModelIds(offered, docsProfile).includes('image'));
});

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
} from '../src/modelChoice.mjs';

const catalog = [
  {id: 'call-e2b', group: 'chat', files: []},
  {id: 'chat-e4b', group: 'chat', files: []},
  {id: 'whisper', group: 'stt', files: []},
  {id: 'image', group: 'image', files: []},
];
const gpuProfile = {chatModel: 'chat-e4b', voice: true, images: true};
const docsProfile = {chatModel: 'call-e2b', voice: true, images: false};

test('offered models follow profile capabilities', () => {
  const full = offeredModels(catalog, gpuProfile).map(m => m.id);
  assert.deepEqual(full, ['call-e2b', 'chat-e4b', 'whisper', 'image']);
  const docs = offeredModels(catalog, docsProfile).map(m => m.id);
  assert.deepEqual(docs, ['call-e2b', 'chat-e4b', 'whisper']);
});

test('--yes keeps recommended defaults including Image Lab when profile.images', () => {
  const offered = offeredModels(catalog, gpuProfile);
  const choice = resolveModelChoiceFromFlags(['--yes'], {}, offered, gpuProfile);
  assert.ok(choice.ids.includes('call-e2b'));
  assert.ok(choice.ids.includes('chat-e4b'));
  assert.ok(choice.ids.includes('whisper'));
  assert.ok(choice.ids.includes('image'));
  assert.equal(choice.images, true);
});

test('--skip-images and LUMICOS_SKIP_IMAGES omit Z-Image and continue', () => {
  const offered = offeredModels(catalog, gpuProfile);
  const a = resolveModelChoiceFromFlags(['--yes', '--skip-images'], {}, offered, gpuProfile);
  assert.equal(a.images, false);
  assert.ok(!a.ids.includes('image'));
  const b = resolveModelChoiceFromFlags(['--yes'], {LUMICOS_SKIP_IMAGES: '1'}, offered, gpuProfile);
  assert.equal(b.images, false);
});

test('--models list and LUMICOS_MODELS select an explicit subset', () => {
  const offered = offeredModels(catalog, gpuProfile);
  const a = resolveModelChoiceFromFlags(['--models', 'call-e2b,whisper'], {}, offered, gpuProfile);
  assert.deepEqual(a.ids.sort(), ['call-e2b', 'whisper']);
  assert.equal(a.images, false);
  const b = resolveModelChoiceFromFlags([], {LUMICOS_MODELS: 'call-e2b,image'}, offered, gpuProfile);
  assert.ok(b.ids.includes('image'));
  assert.equal(b.images, true);
});

test('declining every chat model still keeps one chat model so install can continue', () => {
  const offered = offeredModels(catalog, gpuProfile);
  const choice = finalizeChoice(offered, gpuProfile, ['whisper']);
  assert.ok(choice.ids.includes('call-e2b') || choice.ids.some(id => catalog.find(m => m.id === id)?.group === 'chat'));
  assert.equal(choice.images, false);
});

test('applyModelChoice turns off images without dropping the rest of the profile', () => {
  const offered = offeredModels(catalog, gpuProfile);
  const choice = resolveModelChoiceFromFlags(['--yes', '--skip-images'], {}, offered, gpuProfile);
  const p = applyModelChoice(gpuProfile, choice);
  assert.equal(p.images, false);
  assert.equal(p.voice, true);
  assert.ok(p.modelChoice);
});

test('selectedModels respects persisted modelChoice ids', () => {
  const p = applyModelChoice(gpuProfile, {ids: ['call-e2b'], images: false, chatModel: 'call-e2b'});
  assert.deepEqual(selectedModels(catalog, p).map(m => m.id), ['call-e2b']);
});

test('prompt answering n skips image and continues (does not throw / exit)', async () => {
  const offered = offeredModels(catalog, gpuProfile);
  // Simulate interactive answers without a real TTY/readline (decline e4b + image).
  const answers = [true, false, true, false];
  let i = 0;
  const choice = await promptModelChoice(offered, gpuProfile, {
    askFn: async (_q, _def) => answers[i++],
  });
  assert.equal(i, 4);
  assert.ok(choice.ids.includes('call-e2b'));
  assert.ok(choice.ids.includes('whisper'));
  assert.ok(!choice.ids.includes('chat-e4b'));
  assert.ok(!choice.ids.includes('image'));
  assert.equal(choice.images, false);
});

test('defaultModelIds for docs-focused (no images) never includes image', () => {
  const offered = offeredModels(catalog, docsProfile);
  assert.ok(!defaultModelIds(offered, docsProfile).includes('image'));
});

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, describe, test } from 'node:test';
import { ModelCompatibilityApi } from '../llama/capabilities/compatibility.mjs';
import { buildCapabilityProfile } from '../llama/capabilities/profileBuilder.mjs';
import { CapabilityProfileStore } from '../llama/capabilities/profileStore.mjs';
import { ManualCapabilityProbe } from '../llama/capabilities/probe.mjs';
import { observation, validateCapabilityProfile } from '../llama/capabilities/schema.mjs';
import { ModelCapabilityService } from '../llama/capabilities/service.mjs';
import { makeGguf, readGgufInfo } from '../llama/gguf.mjs';

let root;
before(async () => { root = await fs.mkdtemp(path.join(tmpdir(), 'lumicos-capabilities-')); });
after(async () => { await fs.rm(root, { recursive: true, force: true }); });

async function files(name, { vision = false, template = true } = {}) {
  const model = path.join(root, `${name}.gguf`);
  await fs.writeFile(model, makeGguf({ 'general.architecture': 'fixture', 'general.name': name,
    'general.file_type': 15, 'fixture.context_length': 32768, 'fixture.embedding_length': 2048,
    tags: ['fixture'], ...(template ? { 'tokenizer.chat_template': '{{ messages }}' } : {}) }));
  let mmproj = null;
  if (vision) {
    mmproj = path.join(root, `${name}-mmproj.gguf`);
    await fs.writeFile(mmproj, makeGguf({ 'general.architecture': 'clip', 'clip.has_vision_encoder': true,
      'clip.projector_type': 'mlp', 'clip.vision.projection_dim': 2048 }));
  }
  return { model, mmproj };
}

const runtime = { name: 'llama.cpp', version: 'b7000', executableHash: 'runtime-hash' };

describe('GGUF capability metadata', () => {
  test('optionally reads embedded chat template without changing the default lightweight reader', async () => {
    const f = await files('template-reader');
    assert.equal((await readGgufInfo(f.model)).chatTemplate, undefined);
    assert.equal((await readGgufInfo(f.model, { includeChatTemplate: true })).chatTemplate, '{{ messages }}');
  });
  test('malformed metadata remains an error and never becomes a capability claim', async () => {
    const file = path.join(root, 'malformed.gguf'); await fs.writeFile(file, Buffer.from('not gguf'));
    await assert.rejects(readGgufInfo(file), /Not a GGUF|Unexpected end/);
  });
});

describe('capability profile evidence', () => {
  test('separates metadata/configuration from actual tests and retains unknown', async () => {
    const f = await files('vision-thinking', { vision: true });
    const profile = await buildCapabilityProfile({ id: 'vision', name: 'Vision Fixture', path: f.model,
      mmproj: f.mmproj, ctx: 8192, capabilities: { vision: true, tools: true }, toolFormat: 'json-block' }, runtime);
    assert.equal(profile.context.trained, 32768); assert.equal(profile.context.effectiveConfigured, 8192);
    assert.equal(profile.model.quantization, 'Q4_K_M');
    assert.equal(profile.projector.pairing.ok, true);
    for (const capability of Object.values(profile.capabilities)) assert.equal(capability.status, 'unknown');
    assert.ok(profile.capabilities.vision.sources.includes('metadata'));
    assert.ok(profile.capabilities.toolCalling.sources.includes('configuration'));
  });

  test('only compatibility test evidence may produce supported or unsupported', () => {
    assert.throws(() => observation('supported', ['metadata'], 0.9), /requires compatibility test/);
    assert.equal(observation('unsupported', ['test'], 0.9).status, 'unsupported');
  });

  test('manual probes classify vision, thinking, tools, structured output and languages', async () => {
    const f = await files('probe', { vision: true });
    const profile = await buildCapabilityProfile({ id: 'probe', path: f.model, mmproj: f.mmproj, ctx: 4096,
      capabilities: { vision: true, tools: true }, toolFormat: 'json-block' }, runtime);
    const probe = new ManualCapabilityProbe(async (request) => ({ pass: request.kind !== 'thinking', detail: `fixture ${request.kind}` }),
      { now: () => new Date('2026-10-08T00:00:00.000Z') });
    const tested = await probe.run(profile, [{ kind: 'vision' }, { kind: 'toolCalling' },
      { kind: 'structuredOutput' }, { kind: 'thinking' }, { kind: 'language', language: 'th' }]);
    assert.equal(tested.capabilities.vision.status, 'supported');
    assert.equal(tested.capabilities.thinking.status, 'unsupported');
    assert.equal(tested.languages[0].status, 'supported');
  });
});

describe('profile persistence, invalidation and rollback', () => {
  test('persists versions, survives default model changes, invalidates file/runtime/context and rolls back', async () => {
    const f = await files('persistent');
    const data = { selectedId: 'other', models: [{ id: 'persistent', path: f.model, ctx: 8192,
      capabilities: { vision: false, tools: false }, toolFormat: 'none' }, { id: 'other' }] };
    const modelStore = { get: () => structuredClone(data) };
    const profileFile = path.join(root, 'profiles.json'); let runtimeValue = { ...runtime };
    const profiles = new CapabilityProfileStore(profileFile);
    const service = new ModelCapabilityService(modelStore, profiles, { runtimeResolver: async () => runtimeValue });
    const v1 = await service.inspect('persistent'); assert.equal(v1.profileVersion, 1);
    data.selectedId = 'persistent'; assert.equal((await service.resolve('persistent')).validity, 'valid');
    const v2 = await service.inspect('persistent'); assert.equal(v2.profileVersion, 2);
    const reopened = new CapabilityProfileStore(profileFile); assert.equal(reopened.latest('persistent').profileVersion, 2);
    assert.equal((await reopened.rollback('persistent')).profileVersion, 1);
    runtimeValue = { ...runtime, version: 'b7001' };
    assert.equal((await service.resolve('persistent')).validity, 'invalidated');
    runtimeValue = { ...runtime };
    const original = await fs.readFile(f.model); await fs.appendFile(f.model, Buffer.from([0]));
    assert.equal((await service.resolve('persistent')).validity, 'invalidated');
    await fs.writeFile(f.model, original); data.models[0].ctx = 4096;
    assert.equal((await service.resolve('persistent')).validity, 'invalidated');
  });

  test('failed persistence leaves the previously valid JSON recoverable', async () => {
    const f = await files('rollback-safe'); const file = path.join(root, 'rollback-safe.json');
    const store = new CapabilityProfileStore(file);
    const profile = await buildCapabilityProfile({ id: 'safe', path: f.model, ctx: 4096,
      capabilities: {}, toolFormat: 'none' }, runtime);
    await store.save(profile); const before = await fs.readFile(file, 'utf8');
    await assert.rejects(store.save({ broken: true }));
    assert.equal(await fs.readFile(file, 'utf8'), before);
  });
});

describe('Knowledge compatibility API', () => {
  test('uses safe plain-text fallback until tools and structured output pass tests', async () => {
    const f = await files('compatibility');
    const profile = await buildCapabilityProfile({ id: 'compat', path: f.model, ctx: 4096,
      capabilities: { tools: true }, toolFormat: 'json-block' }, runtime);
    const api = new ModelCompatibilityApi(async () => ({ profile, validity: 'valid' }));
    let result = await api.forKnowledge('compat');
    assert.equal(result.toolTransport, 'plain-text'); assert.equal(result.outputMode, 'plain-text-citations');
    profile.capabilities.toolCalling = observation('supported', ['test'], 0.95, 'passed');
    profile.capabilities.structuredOutput = observation('supported', ['test'], 0.95, 'passed');
    validateCapabilityProfile(profile);
    result = await api.forKnowledge('compat');
    assert.equal(result.toolTransport, 'native-tools'); assert.equal(result.outputMode, 'structured-json');
  });
});

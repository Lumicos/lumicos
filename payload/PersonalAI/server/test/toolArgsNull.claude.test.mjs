import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, prepareArgs } from '../tools/registry.mjs';
import { imageTools, normalizeImageArgs } from '../tools/imageTools.mjs';

const imageRegistry = (calls) => {
  const registry = new ToolRegistry({});
  registry.register(imageTools({ create: async (args) => { calls.push(args); return { id: 'job-1', status: 'queued' }; } })[0]);
  return registry;
};

test('generate_image with "subject": null (Gemma leaving an optional field empty) is checked, approved and run without it', async () => {
  const calls = [];
  const registry = imageRegistry(calls);
  const args = { prompt: 'an orange cat sleeping on a sofa', subject: null, aspect: null, quality: '' };
  const approval = await registry.validate('generate_image', args);
  const result = await registry.execute('generate_image', args, approval.approvalId);
  assert.equal(result.data.jobId, 'job-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, 'an orange cat sleeping on a sofa');
  assert.equal(calls[0].width, 768); // portrait default, because aspect was dropped
});

test('off-list optional values are fixed or dropped instead of failing the picture', async () => {
  const calls = [];
  const registry = imageRegistry(calls);
  const args = { prompt: 'a cat', subject: 'cat', aspect: 'Landscape', quality: 'ultra', width: '1024', height: 9000 };
  const approval = await registry.validate('generate_image', args);
  await registry.execute('generate_image', args, approval.approvalId);
  assert.deepEqual(normalizeImageArgs(args), { prompt: 'a cat', aspect: 'landscape', width: 1024, height: 1536 });
  assert.equal(calls[0].width, 1024);
  assert.equal(calls[0].height, 1536);
});

test('a missing required field still fails, and null stays where the schema allows it', async () => {
  const registry = imageRegistry([]);
  await assert.rejects(registry.validate('generate_image', { prompt: null }), (e) => e.code === 'INVALID_ARGS');
  const tool = { parameters: { type: 'object', required: ['a'], properties: { a: { type: 'string' }, seed: { type: ['integer', 'null'] }, mode: { type: 'string', enum: ['x', 'y'] } } } };
  assert.deepEqual(prepareArgs(tool, { a: 'v', seed: null, mode: '' }), { a: 'v', seed: null });
  assert.deepEqual(prepareArgs(tool, { a: null }), { a: null }); // required: left for the validator to reject
});

test('the approval made for the raw arguments still matches when the same raw arguments are executed', async () => {
  const registry = imageRegistry([]);
  const raw = { prompt: 'x', subject: null };
  const approval = await registry.validate('generate_image', raw);
  await assert.doesNotReject(registry.execute('generate_image', { ...raw }, approval.approvalId));
  const other = await registry.validate('generate_image', raw);
  await assert.rejects(registry.execute('generate_image', { prompt: 'y', subject: null }, other.approvalId), (e) => e.code === 'APPROVAL_MISMATCH');
});

// claude-20261016: zimageTurboByStable_2603INT8Convrot is the primary image model when installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { imageProfiles, routeImage, pickDefaultBackend, primaryImageBackendId, PRIMARY_IMAGE_MODEL, BACKENDS } from '../comfy/imageProfiles.mjs';

function fakeModelDir(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumicos-img-'));
  for (const name of names) {
    // Minimal safetensors: 8-byte little-endian header length + JSON header with the Z-Image layer keys.
    const header = Buffer.from(JSON.stringify({ 'layers.0.attention.qkv.weight': { dtype: 'F8_E4M3', shape: [1], data_offsets: [0, 1] }, 'layers.0.feed_forward.w1.weight': { dtype: 'F8_E4M3', shape: [1], data_offsets: [1, 2] } }));
    const len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(header.length));
    fs.writeFileSync(path.join(dir, name), Buffer.concat([len, header, Buffer.alloc(2)]));
  }
  return dir;
}

test('primary model is detected, flagged primary and chosen as default over z-plus / other models', async () => {
  const dir = fakeModelDir([PRIMARY_IMAGE_MODEL, 'zImageOther_v1.safetensors']);
  const profiles = await imageProfiles({ directory: dir });
  const primary = profiles.find((p) => p.id === primaryImageBackendId());
  assert.ok(primary?.available && primary.primary === true);
  assert.equal(profiles.filter((p) => p.primary).length, 1);
  assert.equal(pickDefaultBackend(profiles.filter((p) => p.available)), primaryImageBackendId());
  // "auto" and an unspecified backend both route to the primary model
  assert.equal(routeImage({ prompt: 'a cat' }).backend, primaryImageBackendId());
  assert.equal(routeImage({ backend: 'auto' }).backend, primaryImageBackendId());
  // an explicit choice is still honoured
  const other = profiles.find((p) => p.file === 'zImageOther_v1.safetensors');
  assert.equal(routeImage({ backend: other.id }).backend, other.id);
});

test('without the primary model the first available model is the default (CyberRealistic/z-plus no longer exists)', async () => {
  const dir = fakeModelDir(['zImageOther_v1.safetensors']);
  const profiles = await imageProfiles({ directory: dir });
  assert.equal(profiles.some((p) => p.primary && p.available), false);
  assert.equal(pickDefaultBackend([{ id: 'x' }, { id: 'y' }]), 'x');
  assert.equal(pickDefaultBackend([{ id: 'x' }]), 'x');
  assert.equal(BACKENDS['z-plus'], undefined);
});

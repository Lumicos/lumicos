import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

export function capabilityFingerprint(identity) {
  return createHash('sha256').update(JSON.stringify({
    modelHash: identity.modelHash, projectorHash: identity.projectorHash ?? null,
    runtimeName: identity.runtimeName, runtimeVersion: identity.runtimeVersion,
    runtimeHash: identity.runtimeHash ?? null, effectiveContext: identity.effectiveContext,
    chatTemplateHash: identity.chatTemplateHash ?? null,
  })).digest('hex');
}


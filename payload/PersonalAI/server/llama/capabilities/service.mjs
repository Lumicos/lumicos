import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildCapabilityProfile } from './profileBuilder.mjs';
import { capabilityFingerprint, sha256File } from './fingerprint.mjs';
import { ModelCompatibilityApi } from './compatibility.mjs';

export class ModelCapabilityService {
  constructor(modelConfigStore, profileStore, { runtimeResolver, probe } = {}) {
    this.models = modelConfigStore; this.profiles = profileStore; this.runtimeResolver = runtimeResolver;
    this.probe = probe; this.compatibility = new ModelCompatibilityApi((id) => this.resolve(id));
  }
  model(id) {
    const model = this.models.get().models.find((item) => item.id === id);
    if (!model) throw new Error(`Registered model not found: ${id}`);
    return model;
  }
  async inspect(id) {
    const model = this.model(id); const runtime = await this.runtimeResolver();
    const draft = await buildCapabilityProfile(model, runtime);
    return this.profiles.save(draft);
  }
  async resolve(id) {
    const latest = this.profiles.latest(id);
    if (!latest) return { profile: null, validity: 'missing' };
    const model = this.model(id); const runtime = await this.runtimeResolver();
    const [modelHash, projectorHash, template] = await Promise.all([
      sha256File(model.path), model.mmproj ? sha256File(model.mmproj) : null,
      model.chatTemplateFile ? fs.readFile(model.chatTemplateFile, 'utf8') : null,
    ]);
    const chatTemplateHash = template ? createHash('sha256').update(template).digest('hex') : latest.chatTemplate.origin === 'metadata' ? latest.chatTemplate.hash : null;
    const fingerprint = capabilityFingerprint({ modelHash,
      projectorHash, runtimeName: runtime.name, runtimeVersion: runtime.version,
      runtimeHash: runtime.executableHash ?? null, effectiveContext: model.ctx,
      chatTemplateHash });
    return this.profiles.resolve(id, fingerprint);
  }
  async runProbes(id, requested) {
    if (!this.probe) throw new Error('No manual capability probe runner configured.');
    const resolved = await this.resolve(id);
    if (resolved.validity !== 'valid') throw new Error('Capability profile is missing or invalidated; inspect it before probing.');
    return this.profiles.save(await this.probe.run(resolved.profile, requested));
  }
  paths() { return { profileStore: path.resolve(this.profiles.file) }; }
}


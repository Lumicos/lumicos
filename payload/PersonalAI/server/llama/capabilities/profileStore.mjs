import fs from 'node:fs';
import { writeAtomic } from '../../util/atomicWrite.mjs';
import { validateCapabilityProfile } from './schema.mjs';

export class CapabilityProfileStore {
  constructor(file, { maxHistory = 10 } = {}) {
    this.file = file; this.maxHistory = maxHistory; this.data = { schemaVersion: 1, profiles: {} };
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed?.schemaVersion !== 1 || typeof parsed.profiles !== 'object') throw new Error('unsupported schema');
        this.data = parsed;
      } catch (error) {
        this.error = `Capability profile store is unreadable: ${error.message}`;
      }
    }
  }
  list(modelId) { return structuredClone(this.data.profiles[modelId] ?? []); }
  latest(modelId) { return this.list(modelId).at(-1) ?? null; }
  resolve(modelId, fingerprint) {
    const profile = this.latest(modelId);
    if (!profile) return { profile: null, validity: 'missing' };
    return { profile, validity: profile.fingerprint === fingerprint ? 'valid' : 'invalidated' };
  }
  async save(profile) {
    const value = validateCapabilityProfile(profile);
    const history = this.data.profiles[value.model.id] ?? [];
    const latest = history.at(-1);
    value.profileVersion = latest ? latest.profileVersion + 1 : 1;
    value.updatedAt = new Date().toISOString();
    this.data.profiles[value.model.id] = [...history, value].slice(-this.maxHistory);
    await writeAtomic(this.file, JSON.stringify(this.data, null, 2), { backup: true });
    return structuredClone(value);
  }
  async rollback(modelId) {
    const history = this.data.profiles[modelId] ?? [];
    if (history.length < 2) throw new Error('No previous capability profile version.');
    history.pop();
    await writeAtomic(this.file, JSON.stringify(this.data, null, 2), { backup: true });
    return structuredClone(history.at(-1));
  }
}


import { CAPABILITY_NAMES, observation, validateCapabilityProfile } from './schema.mjs';

export class ManualCapabilityProbe {
  constructor(runner, { now = () => new Date() } = {}) { this.runner = runner; this.now = now; }
  async run(profile, requested) {
    validateCapabilityProfile(profile);
    if (!Array.isArray(requested) || !requested.length) throw new TypeError('At least one explicit probe is required.');
    const allowed = new Set([...CAPABILITY_NAMES, 'language']);
    if (requested.some((probe) => !allowed.has(probe.kind))) throw new TypeError('Unknown capability probe.');
    const next = structuredClone(profile);
    for (const probe of requested) {
      const result = await this.runner(probe, next);
      if (typeof result?.pass !== 'boolean') throw new TypeError(`Probe ${probe.kind} did not return pass=true/false.`);
      const testedAt = this.now().toISOString();
      const value = observation(result.pass ? 'supported' : 'unsupported', ['test'], result.pass ? 0.95 : 0.9,
        String(result.detail ?? ''), testedAt);
      if (probe.kind === 'language') {
        if (!probe.language) throw new TypeError('Language probe requires a language tag.');
        next.languages = [...next.languages.filter((item) => item.language !== probe.language), { language: probe.language, ...value }];
      } else next.capabilities[probe.kind] = value;
    }
    next.updatedAt = this.now().toISOString();
    return next;
  }
}


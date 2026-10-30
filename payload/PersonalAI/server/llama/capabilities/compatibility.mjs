const usable = (observation) => observation?.status === 'supported';

export class ModelCompatibilityApi {
  constructor(profileProvider) { this.profileProvider = profileProvider; }
  async describe(modelId) {
    const resolved = await this.profileProvider(modelId);
    if (!resolved?.profile || resolved.validity !== 'valid') return { modelId, validity: resolved?.validity ?? 'missing', capabilities: null };
    return { modelId, validity: 'valid', profileVersion: resolved.profile.profileVersion,
      fingerprint: resolved.profile.fingerprint, capabilities: structuredClone(resolved.profile.capabilities),
      context: structuredClone(resolved.profile.context), limitations: [...resolved.profile.limitations] };
  }
  async forKnowledge(modelId, { preferTools = true, preferStructured = true } = {}) {
    const description = await this.describe(modelId);
    if (!description.capabilities) return { ...description, toolTransport: 'plain-text', outputMode: 'plain-text-citations', visionInput: false };
    return { ...description,
      toolTransport: preferTools && usable(description.capabilities.toolCalling) ? 'native-tools' : 'plain-text',
      outputMode: preferStructured && usable(description.capabilities.structuredOutput) ? 'structured-json' : 'plain-text-citations',
      visionInput: usable(description.capabilities.vision),
    };
  }
}


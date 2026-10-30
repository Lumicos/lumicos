export const CAPABILITY_PROFILE_SCHEMA_VERSION = 1;
export const CAPABILITY_STATUSES = Object.freeze(['supported', 'unsupported', 'unknown']);
export const CAPABILITY_NAMES = Object.freeze([
  'chatTemplate', 'toolCalling', 'structuredOutput', 'vision', 'thinking', 'reasoningOutput',
]);

export function observation(status = 'unknown', sources = [], confidence = 0, detail = null, testedAt = null) {
  if (!CAPABILITY_STATUSES.includes(status)) throw new TypeError(`Invalid capability status: ${status}`);
  if (!Array.isArray(sources) || sources.some((source) => !['metadata', 'configuration', 'test'].includes(source))) {
    throw new TypeError('Capability sources must be metadata, configuration, or test.');
  }
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new RangeError('Capability confidence must be 0-1.');
  if (status !== 'unknown' && !sources.includes('test')) throw new TypeError('Supported/unsupported requires compatibility test evidence.');
  return { status, sources: [...new Set(sources)], confidence, detail, testedAt };
}

export function validateCapabilityProfile(profile) {
  if (!profile || profile.schemaVersion !== CAPABILITY_PROFILE_SCHEMA_VERSION) throw new TypeError('Unsupported capability profile schema.');
  if (!profile.model?.id || !/^[a-f0-9]{64}$/i.test(profile.model.fileHash ?? '')) throw new TypeError('Capability profile requires model id and SHA-256 hash.');
  if (!profile.runtime?.name || !profile.runtime?.version) throw new TypeError('Capability profile requires runtime identity.');
  if (!Number.isInteger(profile.profileVersion) || profile.profileVersion < 1) throw new TypeError('Invalid profile version.');
  for (const name of CAPABILITY_NAMES) observation(...Object.values({
    status: profile.capabilities?.[name]?.status,
    sources: profile.capabilities?.[name]?.sources,
    confidence: profile.capabilities?.[name]?.confidence,
    detail: profile.capabilities?.[name]?.detail,
    testedAt: profile.capabilities?.[name]?.testedAt,
  }));
  for (const language of profile.languages ?? []) observation(language.status, language.sources, language.confidence, language.detail, language.testedAt);
  return structuredClone(profile);
}


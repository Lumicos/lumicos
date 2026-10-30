import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { projectorMatches, readGgufInfo } from '../gguf.mjs';
import { capabilityFingerprint, sha256File } from './fingerprint.mjs';
import { CAPABILITY_PROFILE_SCHEMA_VERSION, observation } from './schema.mjs';

const FILE_TYPES = new Map([[0, 'F32'], [1, 'F16'], [2, 'Q4_0'], [3, 'Q4_1'], [7, 'Q8_0'], [8, 'Q5_0'], [9, 'Q5_1'], [10, 'Q2_K'], [11, 'Q3_K_S'], [12, 'Q3_K_M'], [13, 'Q3_K_L'], [14, 'Q4_K_S'], [15, 'Q4_K_M'], [16, 'Q5_K_S'], [17, 'Q5_K_M'], [18, 'Q6_K']]);
const textHash = (value) => createHash('sha256').update(value).digest('hex');

export async function buildCapabilityProfile(model, runtime, { now = () => new Date(), profileVersion = 1 } = {}) {
  if (!model?.id || !model?.path) throw new TypeError('Registered model id and path are required.');
  const [info, modelHash, stat] = await Promise.all([readGgufInfo(model.path, { includeChatTemplate: true }), sha256File(model.path), fs.stat(model.path)]);
  let projector = null; let projectorHash = null; let pairing = null;
  if (model.mmproj) {
    const projectorInfo = await readGgufInfo(model.mmproj);
    projectorHash = await sha256File(model.mmproj);
    pairing = projectorMatches(info, projectorInfo);
    projector = { path: model.mmproj, fileHash: projectorHash, metadata: projectorInfo, pairing };
  }
  let configuredTemplate = null;
  if (model.chatTemplateFile) configuredTemplate = await fs.readFile(model.chatTemplateFile, 'utf8');
  const template = configuredTemplate ?? info.chatTemplate ?? null;
  const runtimeIdentity = { name: String(runtime.name), version: String(runtime.version),
    executableHash: runtime.executableHash ?? null, build: runtime.build ?? null };
  const identity = { modelHash, projectorHash, runtimeName: runtimeIdentity.name, runtimeVersion: runtimeIdentity.version,
    runtimeHash: runtimeIdentity.executableHash, effectiveContext: model.ctx, chatTemplateHash: template ? textHash(template) : null };
  const configuredSources = model.capabilities?.tools || model.capabilities?.vision ? ['configuration'] : [];
  const visionDetail = !model.mmproj ? 'No projector configured.' : pairing?.ok === false ? pairing.reason : pairing?.reason ?? 'Projector configured; runtime test required.';
  return {
    schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION, profileVersion, fingerprint: capabilityFingerprint(identity),
    model: { id: model.id, name: model.name ?? path.basename(model.path), path: model.path, fileHash: modelHash,
      size: stat.size, architecture: info.architecture ?? null,
      quantization: FILE_TYPES.get(info.kv?.['general.file_type']) ?? info.kv?.['general.size_label'] ?? 'unknown',
      ggufVersion: info.version },
    runtime: runtimeIdentity,
    context: { trained: info.contextLength ?? null, effectiveConfigured: model.ctx ?? null,
      source: { trained: info.contextLength == null ? 'unknown' : 'metadata', effectiveConfigured: 'configuration' } },
    chatTemplate: { origin: configuredTemplate ? 'configuration' : info.chatTemplate ? 'metadata' : 'unknown',
      hash: template ? textHash(template) : null, syntax: template ? 'jinja' : 'unknown' },
    projector,
    capabilities: {
      chatTemplate: observation('unknown', template ? [configuredTemplate ? 'configuration' : 'metadata'] : [], template ? 0.45 : 0, template ? 'Template found; llama.cpp compatibility is untested.' : 'No template found.'),
      toolCalling: observation('unknown', model.capabilities?.tools ? configuredSources : [], model.capabilities?.tools ? 0.25 : 0, model.capabilities?.tools ? 'Declared in Model Manager; probe required.' : 'Not tested.'),
      structuredOutput: observation('unknown', model.toolFormat && model.toolFormat !== 'none' ? ['configuration'] : [], model.toolFormat && model.toolFormat !== 'none' ? 0.25 : 0, 'Probe required.'),
      vision: pairing?.ok === false ? observation('unknown', ['metadata', 'configuration'], 0.9, `Definite structural mismatch: ${visionDetail}`) : observation('unknown', model.mmproj ? ['metadata', 'configuration'] : [], model.mmproj ? 0.45 : 0, visionDetail),
      thinking: observation('unknown', [], 0, 'Probe required.'),
      reasoningOutput: observation('unknown', [], 0, 'Probe required.'),
    },
    languages: [], limitations: pairing?.ok === false ? [visionDetail] : [],
    createdAt: now().toISOString(), updatedAt: now().toISOString(),
  };
}


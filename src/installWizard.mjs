/** Exactly two interactive screens, then unattended install choices. */
import {offeredModels, resolveModelChoiceFromFlags, promptModelChoice, applyModelChoice, reconcileCpuWhisper} from './modelChoice.mjs';
import {
  listBackendOptions,
  applyBackendChoice,
  defaultBackendId,
  resolveBackendFromFlags,
  promptBackendChoice,
} from './backendChoice.mjs';

/**
 * Screen 1: backend. Screen 2: models. No further prompts.
 * @param {object} deps.promptBackendChoiceFn / promptModelChoiceFn — inject for tests
 * @returns {{profile, choice, backendId, acceptFallback, promptCount}}
 */
export async function runTwoScreenChoices(hardware, catalog, {
  gpuIndex,
  argv = [],
  env = {},
  auto = false,
  interactive = true,
  promptBackendChoiceFn = promptBackendChoice,
  promptModelChoiceFn = promptModelChoice,
} = {}) {
  let promptCount = 0;
  const wrapBackend = async (...args) => {
    promptCount += 1;
    return promptBackendChoiceFn(...args);
  };
  const wrapModels = async (...args) => {
    promptCount += 1;
    return promptModelChoiceFn(...args);
  };

  let backendId = resolveBackendFromFlags(argv, env);
  if (!backendId) {
    if (interactive && !auto) backendId = await wrapBackend(hardware, {gpuIndex});
    else backendId = defaultBackendId(hardware, {gpuIndex});
  }
  let profile = applyBackendChoice(hardware, backendId, {gpuIndex});

  const offered = offeredModels(catalog, profile);
  let choice = resolveModelChoiceFromFlags(argv, env, offered, profile);
  if (!choice) {
    if (interactive && !auto) choice = await wrapModels(offered, profile);
    else choice = resolveModelChoiceFromFlags(['--yes'], env, offered, profile);
  }

  let acceptFallback = argv.includes('--accept-cpu-whisper');
  if (choice.stt && profile.whisper === 'whisper-cpu') {
    const reconciled = reconcileCpuWhisper(offered, profile, choice, {acceptCpuWhisper: true, dropStt: false});
    choice = reconciled.choice;
    acceptFallback = true;
  }

  profile = applyModelChoice(profile, choice);
  return {
    profile,
    choice,
    backendId,
    acceptFallback,
    promptCount,
    backendOptions: listBackendOptions(hardware, {gpuIndex}),
    offered,
  };
}

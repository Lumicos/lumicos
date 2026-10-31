/** Interactive / flag-driven model selection for the installer. Declining skips; never aborts install. */
import {createInterface} from 'node:readline/promises';

export function offeredModels(catalog, profile) {
  const byId = Object.fromEntries(catalog.map(m => [m.id, m]));
  const out = [];
  // Always offer E2B (boot/start path) and E4B when present in the catalog.
  for (const id of ['call-e2b', 'chat-e4b']) if (byId[id]) out.push({...byId[id], recommended: id === (profile.chatModel || 'call-e2b') || id === 'call-e2b'});
  if (profile.voice && byId.whisper) out.push({...byId.whisper, recommended: true});
  if (profile.images && byId.image) out.push({...byId.image, recommended: true, label: 'Z-Image (Image Lab)'});
  return out;
}

export function defaultModelIds(offered, profile) {
  const ids = new Set();
  for (const m of offered) {
    if (m.group === 'chat' && (m.id === 'call-e2b' || m.id === profile.chatModel || m.recommended)) ids.add(m.id);
    if (m.group === 'stt' && m.recommended) ids.add(m.id);
    if (m.group === 'image' && m.recommended) ids.add(m.id);
  }
  if (![...ids].some(id => offered.find(m => m.id === id)?.group === 'chat')) {
    const chat = offered.find(m => m.group === 'chat');
    if (chat) ids.add(chat.id);
  }
  return [...ids];
}

/** Parse --models=a,b / --skip-images / --yes / LUMICOS_MODELS / LUMICOS_AUTO_MODELS. */
export function resolveModelChoiceFromFlags(argv, env, offered, profile) {
  const listArg = (() => {
    const i = argv.indexOf('--models');
    if (i >= 0 && argv[i + 1]) return argv[i + 1];
    const eq = argv.find(a => a.startsWith('--models='));
    return eq ? eq.slice('--models='.length) : env.LUMICOS_MODELS;
  })();
  const skipImages = argv.includes('--skip-images') || env.LUMICOS_SKIP_IMAGES === '1';
  const auto = argv.includes('--yes') || env.LUMICOS_AUTO_MODELS === '1' || env.LUMICOS_AUTO_MODELS === 'true';
  if (listArg && String(listArg).trim()) {
    const wanted = new Set(String(listArg).split(/[,;\s]+/).map(s => s.trim()).filter(Boolean));
    const ids = offered.filter(m => wanted.has(m.id)).map(m => m.id);
    if (skipImages) return finalizeChoice(offered, profile, ids.filter(id => offered.find(m => m.id === id)?.group !== 'image'));
    return finalizeChoice(offered, profile, ids);
  }
  if (auto || skipImages) {
    let ids = defaultModelIds(offered, profile);
    if (skipImages) ids = ids.filter(id => offered.find(m => m.id === id)?.group !== 'image');
    return finalizeChoice(offered, profile, ids);
  }
  return null;
}

export function finalizeChoice(offered, profile, ids) {
  const set = new Set(ids);
  if (![...set].some(id => offered.find(m => m.id === id)?.group === 'chat')) {
    const fallback = offered.find(m => m.id === 'call-e2b') || offered.find(m => m.group === 'chat');
    if (fallback) set.add(fallback.id);
  }
  const selected = [...set];
  const images = selected.some(id => offered.find(m => m.id === id)?.group === 'image');
  const chatModel = selected.includes(profile.chatModel) ? profile.chatModel : (selected.includes('chat-e4b') ? 'chat-e4b' : 'call-e2b');
  return {ids: selected, images, chatModel};
}

export function applyModelChoice(profile, choice) {
  if (!choice) return profile;
  return {...profile, images: Boolean(profile.images && choice.images), chatModel: choice.chatModel || profile.chatModel, modelChoice: choice};
}

async function ask(rl, question, defaultYes) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${question} [${hint}] `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  if (['y', 'yes', '1'].includes(answer)) return true;
  if (['n', 'no', '0'].includes(answer)) return false;
  console.log('  (skipped as No — install continues)');
  return false;
}

/** Prompt per offered model. Answering no skips that model and continues. */
export async function promptModelChoice(offered, profile, {input = process.stdin, output = process.stdout, askFn} = {}) {
  console.log('Select models to download later / prepare for. Answering No skips that model and continues.');
  const ids = [];
  if (askFn) {
    for (const m of offered) {
      const label = m.label || `${m.id} (${m.group})`;
      const def = defaultModelIds(offered, profile).includes(m.id);
      if (await askFn(`Install ${label}?`, def)) ids.push(m.id);
    }
    return finalizeChoice(offered, profile, ids);
  }
  const rl = createInterface({input, output});
  try {
    for (const m of offered) {
      const label = m.label || `${m.id} (${m.group})`;
      const def = defaultModelIds(offered, profile).includes(m.id);
      const ok = await ask(rl, `Install ${label}?`, def);
      if (ok) ids.push(m.id);
    }
  } finally { rl.close(); }
  return finalizeChoice(offered, profile, ids);
}

export function selectedModels(catalog, profile) {
  const choice = profile.modelChoice;
  if (choice?.ids?.length) return catalog.filter(m => choice.ids.includes(m.id));
  return catalog.filter(m => m.id === profile.chatModel || m.id === 'call-e2b' || (profile.voice && ['stt', 'tts'].includes(m.group)) || (profile.images && m.group === 'image'));
}

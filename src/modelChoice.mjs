/** Interactive / flag-driven model selection for the installer. Declining skips; never aborts install. */
import {selectMenu} from './terminalMenu.mjs';

/** Virtual TTS option (Windows Pattara) — no catalog download. */
export const TTS_OPTION = {
  id: 'tts',
  group: 'tts',
  label: 'Microsoft Pattara TTS (อ่านออกเสียง / read-aloud)',
  recommended: true,
  files: [],
};

export function offeredModels(catalog, profile) {
  const byId = Object.fromEntries(catalog.map(m => [m.id, m]));
  const out = [];
  for (const id of ['call-e2b', 'chat-e4b']) {
    if (byId[id]) {
      out.push({
        ...byId[id],
        label: id === 'call-e2b' ? 'Gemma E2B (chat / call)' : 'Gemma E4B (chat)',
        recommended: id === (profile.chatModel || 'call-e2b') || id === 'call-e2b',
      });
    }
  }
  if (profile.voice && byId.whisper) {
    out.push({...byId.whisper, label: 'Whisper STT (ไมค์ / speech-to-text)', recommended: true});
  }
  if (profile.voice) {
    out.push({...TTS_OPTION, recommended: true});
  }
  if (profile.images && byId.image) {
    out.push({...byId.image, recommended: true, label: 'Z-Image (Image Lab)'});
  }
  return out;
}

export function defaultModelIds(offered, profile) {
  const ids = new Set();
  for (const m of offered) {
    if (m.group === 'chat' && (m.id === 'call-e2b' || m.id === profile.chatModel || m.recommended)) ids.add(m.id);
    if (m.group === 'stt' && m.recommended) ids.add(m.id);
    if (m.group === 'tts' && m.recommended) ids.add(m.id);
    if (m.group === 'image' && m.recommended) ids.add(m.id);
  }
  if (![...ids].some(id => offered.find(m => m.id === id)?.group === 'chat')) {
    const chat = offered.find(m => m.group === 'chat');
    if (chat) ids.add(chat.id);
  }
  return [...ids];
}

function flagList(argv, env) {
  const i = argv.indexOf('--models');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const eq = argv.find(a => a.startsWith('--models='));
  return eq ? eq.slice('--models='.length) : env.LUMICOS_MODELS;
}

/** Parse --models / --skip-* / --yes / env. */
export function resolveModelChoiceFromFlags(argv, env, offered, profile) {
  const listArg = flagList(argv, env);
  const skipImages = argv.includes('--skip-images') || env.LUMICOS_SKIP_IMAGES === '1';
  const skipStt = argv.includes('--skip-stt') || env.LUMICOS_SKIP_STT === '1';
  const skipTts = argv.includes('--skip-tts') || env.LUMICOS_SKIP_TTS === '1';
  const auto = argv.includes('--yes') || env.LUMICOS_AUTO_MODELS === '1' || env.LUMICOS_AUTO_MODELS === 'true';
  if (listArg && String(listArg).trim()) {
    const wanted = new Set(String(listArg).split(/[,;\s]+/).map(s => s.trim()).filter(Boolean));
    let ids = offered.filter(m => wanted.has(m.id)).map(m => m.id);
    if (skipImages) ids = ids.filter(id => offered.find(m => m.id === id)?.group !== 'image');
    if (skipStt) ids = ids.filter(id => offered.find(m => m.id === id)?.group !== 'stt');
    if (skipTts) ids = ids.filter(id => offered.find(m => m.id === id)?.group !== 'tts');
    return finalizeChoice(offered, profile, ids);
  }
  if (auto || skipImages || skipStt || skipTts) {
    let ids = defaultModelIds(offered, profile);
    if (skipImages) ids = ids.filter(id => offered.find(m => m.id === id)?.group !== 'image');
    if (skipStt) ids = ids.filter(id => offered.find(m => m.id === id)?.group !== 'stt');
    if (skipTts) ids = ids.filter(id => offered.find(m => m.id === id)?.group !== 'tts');
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
  const stt = selected.some(id => offered.find(m => m.id === id)?.group === 'stt');
  const tts = selected.some(id => offered.find(m => m.id === id)?.group === 'tts');
  const chatModel = selected.includes(profile.chatModel)
    ? profile.chatModel
    : (selected.includes('chat-e4b') ? 'chat-e4b' : 'call-e2b');
  return {ids: selected, images, stt, tts, chatModel};
}

export function applyModelChoice(profile, choice) {
  if (!choice) return profile;
  return {
    ...profile,
    images: Boolean(profile.images && choice.images),
    voice: Boolean(profile.voice && (choice.stt || choice.tts)),
    chatModel: choice.chatModel || profile.chatModel,
    modelChoice: choice,
  };
}

function menuItems(offered) {
  return offered.map(m => ({
    id: m.id,
    label: m.label || `${m.id} (${m.group})`,
    hint: m.recommended ? 'แนะนำ / recommended' : undefined,
  }));
}

/**
 * Arrow-key multi-select (TTY) or numbered fallback. askFn forces fallback (tests).
 * Declining items skips them; install continues. At least one chat model is kept.
 */
export async function promptModelChoice(offered, profile, {input = process.stdin, output = process.stdout, askFn} = {}) {
  const defaults = defaultModelIds(offered, profile);
  const selected = offered.map((m, i) => defaults.includes(m.id) ? i : -1).filter(i => i >= 0);
  const ids = await selectMenu({
    title: 'เลือกโมเดล / Select models to prepare (Space = toggle · Enter = confirm)',
    hint: '↑/↓ เลื่อน · Space สลับ · Enter ยืนยัน  |  ↑/↓ move · Space toggle · Enter confirm\nปฏิเสธได้ — ตัวติดตั้งไม่หยุด / Declining skips; install continues.',
    multi: true,
    items: menuItems(offered),
    selected,
  }, {input, output, askFn});
  return finalizeChoice(offered, profile, ids);
}

/** Catalog rows to download/link — excludes virtual TTS. */
export function selectedModels(catalog, profile) {
  const choice = profile.modelChoice;
  if (choice?.ids?.length) {
    return catalog.filter(m => choice.ids.includes(m.id));
  }
  return catalog.filter(m =>
    m.id === profile.chatModel
    || m.id === 'call-e2b'
    || (profile.voice && ['stt', 'tts'].includes(m.group))
    || (profile.images && m.group === 'image'));
}

export function choiceEnables(profile, group) {
  const c = profile.modelChoice;
  if (!c) {
    if (group === 'image') return !!profile.images;
    if (group === 'stt' || group === 'tts') return !!profile.voice;
    return true;
  }
  if (group === 'image') return !!c.images;
  if (group === 'stt') return !!c.stt;
  if (group === 'tts') return !!c.tts;
  return true;
}

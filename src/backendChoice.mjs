/** GPU / compute backend picker for the two-screen installer. */
import {selectProfile} from './profile.mjs';
import {selectMenu} from './terminalMenu.mjs';

const AMD_MAP = [
  [/RX\s*9070|R9700/i, 'gfx1201'],
  [/RX\s*9060/i, 'gfx1200'],
  [/RX\s*7900/i, 'gfx1100'],
  [/RX\s*(7700|7800)/i, 'gfx1101'],
  [/RX\s*7600/i, 'gfx1102'],
  [/RX\s*(6600|6650)/i, 'gfx1032'],
  [/RX\s*(6700|6750)/i, 'gfx1031'],
  [/RX\s*(6800|6900|6950)/i, 'gfx1030'],
];

function pickGpuIndex(hardware, gpuIndex) {
  const gpus = hardware.gpus ?? [];
  if (gpuIndex !== undefined && gpuIndex !== null && gpuIndex !== '') {
    const i = Number(gpuIndex);
    if (!Number.isInteger(i) || !gpus[i]) throw Error('Invalid GPU index');
    return i;
  }
  return gpus
    .map((g, i) => ({i, score: (g.vramGiB ?? 0) + (/NVIDIA|Radeon RX/i.test(g.name) ? 100 : 0)}))
    .sort((a, b) => b.score - a.score)[0]?.i ?? null;
}

function amdTarget(name) {
  return AMD_MAP.find(([re]) => re.test(name))?.[1] ?? null;
}

function optionMatchesProfile(opt, profile) {
  if (opt.id === 'cuda13') return profile.llama === 'llama-cuda13';
  if (opt.id === 'cuda12') return profile.llama === 'llama-cuda12';
  if (opt.id === 'rocm') return profile.backend === 'rocm';
  if (opt.id === 'vulkan') return profile.backend === 'vulkan';
  if (opt.id === 'cpu') return profile.backend === 'cpu';
  return false;
}

/**
 * Valid backend options for this hardware (only show what the machine can use).
 * Recommended matches selectProfile() auto choice.
 */
export function listBackendOptions(hardware, {gpuIndex} = {}) {
  const gpus = hardware.gpus ?? [];
  const index = pickGpuIndex(hardware, gpuIndex);
  const gpu = (index != null ? gpus[index] : null) ?? {name: 'CPU', vramGiB: 0};
  const cuda = Number(hardware.cudaMax);
  const is50 = /RTX\s*50\d\d/i.test(gpu.name);
  const options = [];

  if (/NVIDIA/i.test(gpu.name)) {
    if (cuda >= 13) {
      options.push({
        id: 'cuda13',
        label: 'NVIDIA CUDA 13',
        hint: `${gpu.name} · llama-cuda13 / cu130`,
        backend: 'cuda', llama: 'llama-cuda13', torch: 'cu130',
        whisper: is50 ? 'whisper-cpu' : 'whisper-cuda',
        target: null,
      });
    }
    if (cuda >= 12.4 && !is50) {
      options.push({
        id: 'cuda12',
        label: 'NVIDIA CUDA 12.4',
        hint: `${gpu.name} · llama-cuda12 / cu124`,
        backend: 'cuda', llama: 'llama-cuda12', torch: 'cu124',
        whisper: 'whisper-cuda',
        target: null,
      });
    }
    options.push({
      id: 'vulkan',
      label: 'Vulkan (NVIDIA)',
      hint: `${gpu.name} · no CUDA images`,
      backend: 'vulkan', llama: 'llama-vulkan', torch: 'cpu',
      whisper: 'whisper-cpu',
      target: null,
    });
  } else if (/Radeon.*(?:RX\s*(?:6\d\d\d|7\d\d\d|9\d\d\d)|AI PRO R9700)/i.test(gpu.name)) {
    const target = amdTarget(gpu.name);
    if (target) {
      options.push({
        id: 'rocm',
        label: 'AMD ROCm',
        hint: `${gpu.name} · ${target}`,
        backend: 'rocm', llama: 'llama-rocm', torch: 'rocm',
        whisper: 'whisper-cpu',
        target,
      });
    }
    options.push({
      id: 'vulkan',
      label: 'Vulkan (AMD)',
      hint: `${gpu.name} · chat only`,
      backend: 'vulkan', llama: 'llama-vulkan', torch: 'cpu',
      whisper: 'whisper-cpu',
      target: null,
    });
  } else if (gpus.length) {
    options.push({
      id: 'vulkan',
      label: 'Vulkan',
      hint: `${gpu.name} · chat only`,
      backend: 'vulkan', llama: 'llama-vulkan', torch: 'cpu',
      whisper: 'whisper-cpu',
      target: null,
    });
  }

  options.push({
    id: 'cpu',
    label: 'CPU only',
    hint: 'slowest · no GPU images',
    backend: 'cpu', llama: 'llama-cpu', torch: 'cpu',
    whisper: 'whisper-cpu',
    target: null,
  });

  const auto = selectProfile(hardware, {gpuIndex: index ?? undefined});
  for (const o of options) {
    o.recommended = optionMatchesProfile(o, auto);
    o.gpuIndex = index;
    o.gpuName = gpu.name;
    o.vramGiB = gpu.vramGiB;
  }
  // Exactly one recommended when possible
  if (!options.some(o => o.recommended)) {
    options[0].recommended = true;
  }
  return options;
}

/** Apply a backend option id onto a fresh selectProfile base (VRAM/chat/images rules preserved). */
export function applyBackendChoice(hardware, backendId, {gpuIndex} = {}) {
  const options = listBackendOptions(hardware, {gpuIndex});
  const opt = options.find(o => o.id === backendId);
  if (!opt) throw Error('Unknown or invalid backend: ' + backendId);

  const base = selectProfile(hardware, {gpuIndex: opt.gpuIndex ?? gpuIndex});
  const vram = base.gpu?.vramGiB;
  const gpuFeatures = ['cuda', 'rocm'].includes(opt.backend) && Number.isFinite(vram) && vram >= 7.5;
  const errors = [...base.errors];
  const warnings = [...base.warnings];
  return {
    ...base,
    id: `windows-${opt.backend}-${opt.target ?? opt.torch}`,
    backend: opt.backend,
    llama: opt.llama,
    torch: opt.torch,
    target: opt.target,
    whisper: opt.whisper,
    images: gpuFeatures,
    context: Number.isFinite(vram) && vram >= 12 ? 8192 : 4096,
    chatModel: Number.isFinite(vram) && vram >= 7.5 ? 'chat-e4b' : 'call-e2b',
    ngl: opt.backend === 'cpu' ? 0 : 99,
    voice: true,
    errors,
    warnings,
    backendChoice: opt.id,
  };
}

export function defaultBackendId(hardware, {gpuIndex} = {}) {
  const options = listBackendOptions(hardware, {gpuIndex});
  return options.find(o => o.recommended)?.id ?? options[0]?.id;
}

/** Parse --backend / LUMICOS_BACKEND. */
export function resolveBackendFromFlags(argv = [], env = {}) {
  const i = argv.indexOf('--backend');
  if (i >= 0 && argv[i + 1]) return String(argv[i + 1]).trim();
  const eq = argv.find(a => a.startsWith('--backend='));
  if (eq) return eq.slice('--backend='.length).trim();
  if (env.LUMICOS_BACKEND) return String(env.LUMICOS_BACKEND).trim();
  return null;
}

export async function promptBackendChoice(hardware, {gpuIndex, input, output, askFn, selectMenuFn} = {}) {
  const options = listBackendOptions(hardware, {gpuIndex});
  const recommended = options.findIndex(o => o.recommended);
  const gpu = options[0];
  const vram = gpu?.vramGiB;
  const vramText = Number.isFinite(vram) ? `${vram} GiB VRAM` : 'VRAM unknown';
  const title = `เลือก GPU backend / Select GPU backend — ${gpu?.gpuName || 'CPU'} (${vramText})`;
  const items = options.map(o => ({
    id: o.id,
    label: o.label,
    hint: o.hint,
    recommended: !!o.recommended,
  }));
  const select = selectMenuFn || selectMenu;
  const ids = await select({
    title,
    instruction: '↑↓ เลื่อน · Enter ยืนยัน  |  ↑↓ move · Enter confirm',
    multi: false,
    items,
    selected: [recommended >= 0 ? recommended : 0],
  }, {input, output, askFn});
  return ids[0] || options[recommended >= 0 ? recommended : 0].id;
}

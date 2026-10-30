/** Call sounds made with WebAudio (no audio files): ringback while connecting, chimes on connect/hang-up. */
let ctx: AudioContext | null = null;
let ringTimer: ReturnType<typeof setInterval> | null = null;
const audio = () => (ctx ??= new AudioContext());

function tone(freqs: number[], start: number, length: number, volume = 0.08) {
  const c = audio();
  const gain = c.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.03);
  gain.gain.setValueAtTime(volume, start + length - 0.05);
  gain.gain.linearRampToValueAtTime(0, start + length);
  gain.connect(c.destination);
  for (const f of freqs) {
    const osc = c.createOscillator();
    osc.type = 'sine'; osc.frequency.value = f;
    osc.connect(gain); osc.start(start); osc.stop(start + length + 0.02);
  }
}

/** Ring-back like a phone line: two short rings, then a pause. Safe to call repeatedly. */
export function startRinging() {
  if (ringTimer) return;
  const c = audio(); void c.resume();
  const ring = () => { const t = c.currentTime + 0.05; tone([440, 480], t, 0.4); tone([440, 480], t + 0.6, 0.4); };
  ring();
  ringTimer = setInterval(ring, 3000);
}
export function stopRinging() { if (ringTimer) { clearInterval(ringTimer); ringTimer = null; } }
export function playConnected() { stopRinging(); const t = audio().currentTime + 0.02; tone([660], t, 0.12, 0.06); tone([880], t + 0.13, 0.16, 0.06); }
export function playHangup() { stopRinging(); const t = audio().currentTime + 0.02; tone([620], t, 0.14, 0.06); tone([420], t + 0.16, 0.22, 0.06); }

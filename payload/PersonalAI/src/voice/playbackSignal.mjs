// Page-owned observers attach to existing players; no player, decoder or timer here.
const players = new Set();
const observers = new Set();
export function registerPlayback(player) {
  players.add(player);
  if (observers.size) player.attach();
  return (interrupted = true) => {
    player.detach(); players.delete(player);
    if (interrupted && !players.size) for (const reset of observers) reset();
  };
}
export function observePlayback(reset) {
  observers.add(reset);
  if (observers.size === 1) for (const player of players) player.attach();
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true; observers.delete(reset);
    if (!observers.size) for (const player of players) player.detach();
  };
}
export function playbackAmplitude() {
  let amplitude = 0;
  for (const player of players) amplitude = Math.max(amplitude, player.read());
  return amplitude;
}
/** The current phoneme estimate only exists while its scheduled PCM is audible. */
export function playbackViseme() {
  for (const player of players) {
    try { const viseme=player.readViseme?.(); if(viseme)return viseme; } catch { /* Lip sync falls back to amplitude. */ }
  }
  return null;
}

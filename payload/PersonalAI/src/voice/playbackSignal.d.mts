export function registerPlayback(player: { attach(): void; detach(): void; read(): number }): (interrupted?:boolean) => void;
export function observePlayback(reset: () => void): () => void;
export function playbackAmplitude(): number;

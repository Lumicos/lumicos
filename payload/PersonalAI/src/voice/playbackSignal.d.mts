export function registerPlayback(player: { attach(): void; detach(): void; read(): number; readViseme?(): 'A'|'E'|'I'|'O'|'U'|null }): (interrupted?:boolean) => void;
export function observePlayback(reset: () => void): () => void;
export function playbackAmplitude(): number;
export function playbackViseme(): 'A'|'E'|'I'|'O'|'U'|null;

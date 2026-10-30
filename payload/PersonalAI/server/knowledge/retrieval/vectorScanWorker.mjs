import { parentPort } from 'node:worker_threads';

parentPort.on('message', ({ query, candidates, limit }) => {
  const ranked = candidates.map((candidate) => {
    const vector = new Float32Array(candidate.vector);
    let score = 0;
    for (let i = 0; i < query.length; i++) score += query[i] * vector[i];
    return { ...candidate.meta, score };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
  parentPort.postMessage(ranked);
});

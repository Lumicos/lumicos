import { Worker } from 'node:worker_threads';
import { decodeVector, encodeVector } from '../embedding/vectorCodec.mjs';

export function vectorSearchOffThread(queryVector, rows, { dimension, limit = 10 } = {}) {
  encodeVector(queryVector, dimension);
  const candidates = rows.map(({ vectorBlob, dimension: storedDimension, ...meta }) => {
    if (storedDimension !== dimension) throw new RangeError('Stored vector dimension mismatch.');
    return { meta, vector: decodeVector(vectorBlob, dimension).buffer };
  });
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./vectorScanWorker.mjs', import.meta.url));
    worker.once('message', (result) => { resolve(result); worker.terminate(); });
    worker.once('error', reject);
    worker.postMessage({ query: Array.from(queryVector), candidates, limit });
  });
}

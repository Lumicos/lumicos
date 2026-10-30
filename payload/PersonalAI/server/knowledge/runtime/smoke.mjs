import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TransformersEmbedder } from '../embedding/transformersEmbedder.mjs';
import { normalized } from '../embedding/vectorCodec.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const modelRoot = path.resolve(here, '../../../data/models/embeddings');
const embedder = new TransformersEmbedder({ modelRoot });
try {
  const started = performance.now();
  const query = await embedder.embedQuery('ระบบค้นหาเอกสารในเครื่อง');
  const [passage] = await embedder.embedPassages(['Lumicos supports local document retrieval.']);
  console.log(JSON.stringify({ ok: true, modelFile: embedder.lastModelFile,
    dtype: embedder.profile.dtype, queryDimension: query.length, passageDimension: passage.length,
    finite: [...query, ...passage].every(Number.isFinite), normalized: normalized(query) && normalized(passage),
    elapsedMs: Math.round(performance.now() - started), childMetrics: embedder.lastMetrics }, null, 2));
} finally { await embedder.close(); }

import fs from 'node:fs';
import path from 'node:path';
import { env, pipeline } from '@huggingface/transformers';

const modelRoot = process.env.LUMICOS_EMBEDDING_MODEL_ROOT;
const modelId = 'Xenova/multilingual-e5-small';
const int8File = path.join(modelRoot, modelId, 'onnx', 'model_int8.onnx');
if (!modelRoot || !fs.existsSync(int8File)) throw new Error(`Pinned INT8 model not found: ${int8File}`);
const onnxFiles = fs.readdirSync(path.dirname(int8File)).filter((name) => name.endsWith('.onnx'));
if (onnxFiles.length !== 1 || onnxFiles[0] !== 'model_int8.onnx') throw new Error('Embedding model directory must contain only model_int8.onnx.');

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = modelRoot;
env.useBrowserCache = false;
let extractor;

async function getExtractor() {
  extractor ??= pipeline('feature-extraction', modelId, { dtype: 'int8', device: 'cpu',
    session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 } });
  return extractor;
}

async function embed(texts, prefix) {
  const pipe = await getExtractor();
  const output = await pipe(texts.map((text) => `${prefix}${text}`), { pooling: 'mean', normalize: true });
  const rows = output.tolist();
  for (const row of rows) {
    if (row.length !== 384 || row.some((value) => !Number.isFinite(value))) throw new Error('Invalid embedding output.');
  }
  return rows;
}

let serial = Promise.resolve();
process.on('message', (message) => {
  serial = serial.then(async () => {
  try {
    const prefix = message.kind === 'query' ? 'query: ' : 'passage: ';
    const vectors = await embed(message.texts, prefix);
    process.send?.({ id: message.id, ok: true, vectors, modelFile: int8File,
      metrics: { memory: process.memoryUsage(), cpu: process.cpuUsage() } });
  } catch (error) {
    process.send?.({ id: message.id, ok: false, error: String(error?.stack ?? error) });
  }
  });
});

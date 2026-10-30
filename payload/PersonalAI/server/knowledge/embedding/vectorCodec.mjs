export function encodeVector(vector, expectedDimension) {
  const values = vector instanceof Float32Array ? vector : Float32Array.from(vector ?? []);
  if (values.length !== expectedDimension) throw new RangeError(`Expected vector dimension ${expectedDimension}, got ${values.length}.`);
  for (const value of values) if (!Number.isFinite(value)) throw new TypeError('Vector contains NaN or Infinity.');
  return Buffer.from(values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength));
}

export function decodeVector(blob, expectedDimension) {
  const bytes = Buffer.from(blob);
  if (bytes.byteLength !== expectedDimension * 4) throw new RangeError('Stored vector byte length does not match its dimension.');
  const copy = Uint8Array.from(bytes);
  return new Float32Array(copy.buffer);
}

export function normalized(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  return Math.abs(Math.sqrt(sum) - 1) < 1e-4;
}

/**
 * Minimal Server-Sent Events reader for fetch() responses.
 * Yields the `data:` payload of each event as it arrives.
 */
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line.
      let m: RegExpMatchArray | null;
      while ((m = buffer.match(/\r?\n\r?\n/)) && m.index !== undefined) {
        const rawEvent = buffer.slice(0, m.index);
        buffer = buffer.slice(m.index + m[0].length);
        const data = rawEvent
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (data) yield data;
      }
    }
    // Flush a trailing event without a blank line.
    const tail = buffer.trim();
    if (tail.startsWith('data:')) yield tail.slice(5).trimStart();
  } finally {
    reader.releaseLock();
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('payload/PersonalAI/src');
const banned = [
  'reactionFeed',
  'cancelReactions',
  'playbackViseme',
  'avatar-stage/',
  'reactionIntent',
  'reactionSignal',
  'visemeTimeline',
  'reactionChat',
];
const skipExt = new Set(['.css', '.map']);

async function* walk(dir) {
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'avatar-stage') continue;
      yield* walk(p);
    } else if (!skipExt.has(path.extname(ent.name))) yield p;
  }
}

test('PersonalAI src has no dangling avatar-stage / reaction / viseme references', async () => {
  const hits = [];
  for await (const file of walk(root)) {
    const text = await fs.readFile(file, 'utf8');
    for (const token of banned) {
      if (text.includes(token)) hits.push(`${path.relative(root, file)}: ${token}`);
    }
  }
  assert.deepEqual(hits, [], hits.join('\n'));
});

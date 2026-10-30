// claude-20261016: memories are per agent; the one-time split hands shared memories to Lumicos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonMemoryStore } from '../memory/memoryStore.mjs';
import { KeywordMemoryRetriever } from '../memory/retriever.mjs';

test('assignUnscoped moves shared memories to one agent and keeps scoped ones', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mem-')), 'memory.json');
  const store = new JsonMemoryStore(file);
  await store.create({ content: 'ชอบกาแฟดำ', characterId: null });
  await store.create({ content: 'เป็นโปรแกรมเมอร์', characterId: 'default-assistant' });
  assert.equal(await store.assignUnscoped('default-mina'), 1);
  const all = await store.list();
  assert.deepEqual(all.map((m) => m.characterId).sort(), ['default-assistant', 'default-mina']);
  assert.equal(await store.assignUnscoped('default-mina'), 0);
  const again = new JsonMemoryStore(file); // persisted
  assert.deepEqual((await again.list()).map((m) => m.characterId).sort(), ['default-assistant', 'default-mina']);
  const r = new KeywordMemoryRetriever(again);
  const forAssistant = await r.retrieve({ query: 'โปรแกรมเมอร์ กาแฟดำ', characterId: 'default-assistant', limit: 6 });
  assert.ok(forAssistant.every((m) => m.characterId === 'default-assistant'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { takeSnapshot, listSnapshots, shouldSnapshot, restoreSnapshot, startDataSnapshots } from '../util/dataSnapshot.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data'), workspaceDir = path.join(root, 'workspace');
  fs.mkdirSync(path.join(dataDir, 'roleplay', 'c1'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'generated-images'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'conversations.json'), JSON.stringify({ conversations: [{ id: 'c1' }], characters: [{ id: 'mira' }] }));
  fs.writeFileSync(path.join(dataDir, 'memory.json'), '[{"text":"ชอบชาไทย"}]');
  fs.writeFileSync(path.join(dataDir, 'roleplay', 'c1', 'story.md'), 'เรื่องเดิม');
  fs.writeFileSync(path.join(dataDir, 'generated-images', 'big.png'), Buffer.alloc(1000));
  const db = new DatabaseSync(path.join(dataDir, 'knowledge.db'));
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE docs(id TEXT, body TEXT); INSERT INTO docs VALUES ('d1','สวัสดี');");
  t.after(() => { try { db.close(); } catch {} });
  for (const d of ['skills/vat', 'notes', 'exports']) fs.mkdirSync(path.join(workspaceDir, d), { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, 'skills', 'vat', 'SKILL.md'), '# vat');
  fs.writeFileSync(path.join(workspaceDir, 'notes', 'n.md'), 'note');
  fs.writeFileSync(path.join(workspaceDir, 'exports', 'chart.png'), 'png');
  return { root, dataDir, workspaceDir, db };
}

test('snapshot copies user data, a readable knowledge.db while it is open in WAL mode, and skips images/exports', async (t) => {
  const { dataDir, workspaceDir } = fixture(t);
  const s = await takeSnapshot({ dataDir, workspaceDir, now: new Date(2026, 9, 22, 15, 0, 0) });
  assert.equal(s.name, '20261022-150000');
  const has = (p) => fs.existsSync(path.join(s.dir, p));
  for (const p of ['data/conversations.json', 'data/memory.json', 'data/roleplay/c1/story.md', 'workspace/skills/vat/SKILL.md', 'workspace/notes/n.md', 'manifest.json']) assert.ok(has(p), p);
  for (const p of ['data/generated-images', 'workspace/exports']) assert.ok(!has(p), p);
  const copy = new DatabaseSync(path.join(s.dir, 'data/knowledge.db'), { readOnly: true });
  assert.equal(copy.prepare('SELECT body FROM docs').get().body, 'สวัสดี');
  copy.close();
  assert.deepEqual(s.invalidJson, []);
  assert.ok(s.totalBytes > 0);
});

test('broken JSON is still copied but flagged in the manifest', async (t) => {
  const { dataDir, workspaceDir } = fixture(t);
  fs.writeFileSync(path.join(dataDir, 'memory.json'), '[{"text": "cut off');
  const s = await takeSnapshot({ dataDir, workspaceDir });
  assert.deepEqual(s.invalidJson, ['data/memory.json']);
});

test('keeps only the newest N snapshots and schedules by age', async (t) => {
  const { dataDir, workspaceDir } = fixture(t);
  for (let day = 1; day <= 5; day++) await takeSnapshot({ dataDir, workspaceDir, keep: 3, now: new Date(2026, 9, day, 9, 0, 0) });
  assert.deepEqual(listSnapshots(dataDir).map((s) => s.name), ['20261003-090000', '20261004-090000', '20261005-090000']);
  assert.equal(shouldSnapshot(dataDir, new Date(2026, 9, 5, 20, 0, 0)), false);
  assert.equal(shouldSnapshot(dataDir, new Date(2026, 9, 6, 6, 0, 0)), true);
  const two = await takeSnapshot({ dataDir, workspaceDir, keep: 10, now: new Date(2026, 9, 5, 9, 0, 0) });
  assert.equal(two.name, '20261005-090000-2');
});

test('restore moves current files aside (nothing deleted) and brings the snapshot back', async (t) => {
  const { dataDir, workspaceDir } = fixture(t);
  const s = await takeSnapshot({ dataDir, workspaceDir });
  fs.writeFileSync(path.join(dataDir, 'conversations.json'), '{"conversations":[]}');
  fs.writeFileSync(path.join(dataDir, 'roleplay', 'c1', 'story.md'), 'เรื่องพัง');
  fs.writeFileSync(path.join(workspaceDir, 'notes', 'n.md'), 'new note');
  const r = await restoreSnapshot({ dataDir, workspaceDir, name: s.name, now: new Date(2026, 9, 22, 16, 0, 0) });
  assert.deepEqual(r.restored, ['data/conversations.json', 'data/memory.json', 'data/roleplay']);
  assert.match(fs.readFileSync(path.join(dataDir, 'conversations.json'), 'utf8'), /mira/);
  assert.equal(fs.readFileSync(path.join(dataDir, 'roleplay', 'c1', 'story.md'), 'utf8'), 'เรื่องเดิม');
  assert.equal(fs.readFileSync(path.join(r.parked, 'data/conversations.json'), 'utf8'), '{"conversations":[]}');
  assert.equal(fs.readFileSync(path.join(r.parked, 'data/roleplay/c1/story.md'), 'utf8'), 'เรื่องพัง');
  assert.equal(fs.readFileSync(path.join(workspaceDir, 'notes', 'n.md'), 'utf8'), 'new note', 'workspace untouched by default');
  assert.ok(!listSnapshots(dataDir).some((x) => x.name.startsWith('replaced')), 'parked folder is not listed as a snapshot');
  const r2 = await restoreSnapshot({ dataDir, workspaceDir, name: s.name, parts: ['workspace/notes'] });
  assert.equal(fs.readFileSync(path.join(workspaceDir, 'notes', 'n.md'), 'utf8'), 'note');
  assert.equal(fs.readFileSync(path.join(r2.parked, 'workspace/notes/n.md'), 'utf8'), 'new note');
});

test('scheduler snapshots once, then waits; failures are logged, not thrown', async (t) => {
  const { dataDir, workspaceDir } = fixture(t);
  const lines = [];
  const log = { log: (m) => lines.push(m), warn: (...m) => lines.push(m.join(' ')) };
  const sched = startDataSnapshots({ dataDir, workspaceDir, log, firstDelayMs: 1e9, checkEveryMs: 1e9 });
  t.after(() => sched.stop());
  assert.ok(await sched.tick());
  assert.equal(await sched.tick(), null);
  assert.match(lines[0], /\[snapshot\] saved \d{8}-\d{6}/);
  const bad = startDataSnapshots({ dataDir: path.join(dataDir, 'nope', '\0bad'), workspaceDir, log, firstDelayMs: 1e9, checkEveryMs: 1e9 });
  t.after(() => bad.stop());
  assert.equal(await bad.tick(), null);
  assert.match(lines.at(-1), /\[snapshot\] failed/);
});

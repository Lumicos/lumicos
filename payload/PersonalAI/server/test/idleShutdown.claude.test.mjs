import test from 'node:test';
import assert from 'node:assert/strict';
import { countsAsUse, createIdleShutdown, idleMinutesFromEnv } from '../idleShutdown.mjs';

test('polling does not count as use; actions do', () => {
  assert.equal(countsAsUse({ method: 'GET', url: '/api/voice/status' }), false);
  assert.equal(countsAsUse({ method: 'GET', url: '/llama/health' }), false);
  assert.equal(countsAsUse({ method: 'POST', url: '/api/session' }), false);
  assert.equal(countsAsUse({ method: 'POST', url: '/api/images/warm' }), false);
  assert.equal(countsAsUse({ method: 'POST', url: '/api/chat/submit' }), true);
  assert.equal(countsAsUse({ method: 'POST', url: '/api/images/jobs?x=1' }), true);
  assert.equal(countsAsUse({ method: 'PUT', url: '/api/images/lab-cover/a' }), true);
});

test('minutes from env: default 30, 0 turns it off', () => {
  assert.equal(idleMinutesFromEnv({}), 30);
  assert.equal(idleMinutesFromEnv({ LUMICOS_IDLE_STOP_MINUTES: '45' }), 45);
  assert.equal(idleMinutesFromEnv({ LUMICOS_IDLE_STOP_MINUTES: '0' }), 0);
  assert.equal(idleMinutesFromEnv({ LUMICOS_IDLE_STOP_MINUTES: 'abc' }), 0);
});

function setup(minutes = 30) {
  let t = 0, busy = false, stops = 0;
  const idle = createIdleShutdown({ minutes, now: () => t, isBusy: () => busy, onIdle: () => stops++, log: () => {} });
  return { idle, at: m => { t = m * 60_000; }, setBusy: b => { busy = b; }, stops: () => stops };
}

test('stops after 30 idle minutes, once', () => {
  const s = setup();
  s.at(29); assert.equal(s.idle.check(), false);
  s.at(30); assert.equal(s.idle.check(), true);
  s.at(31); assert.equal(s.idle.check(), false);
  assert.equal(s.stops(), 1);
});

test('a real request resets the clock; polling does not', () => {
  const s = setup();
  const h = s.idle.wrap(() => {});
  s.at(20); h({ method: 'POST', url: '/api/chat/submit' }, {});
  s.at(40); h({ method: 'POST', url: '/api/session' }, {}); h({ method: 'GET', url: '/llama/health' }, {});
  assert.equal(s.idle.check(), false);
  s.at(50); assert.equal(s.idle.check(), true);
});

test('never stops while work is running; the 30 minutes count from when it ends', () => {
  const s = setup();
  s.setBusy(true); s.at(90); assert.equal(s.idle.check(), false);
  s.setBusy(false); s.at(100); assert.equal(s.idle.check(), false);
  s.at(120); assert.equal(s.idle.check(), true);
});

test('busy check that throws counts as busy', () => {
  let t = 0, stops = 0;
  const idle = createIdleShutdown({ minutes: 1, now: () => t, isBusy: () => { throw new Error('x'); }, onIdle: () => stops++, log: () => {} });
  t = 10 * 60_000; assert.equal(idle.check(), false); assert.equal(stops, 0);
});

test('off when minutes is 0', () => {
  const s = setup(0); s.at(999); assert.equal(s.idle.check(), false);
});

// 2026-10-22: the stop script ran at the idle time but stopped nothing (Lumicos had been started by the login task).
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runStopScript } from '../idleShutdown.mjs';

const fakeSpawn = (behaviour) => (cmd, args, opts) => {
  const child = new EventEmitter();
  child.unref = () => {};
  child.args = args; child.opts = opts;
  setTimeout(() => behaviour(child), 5);
  return child;
};

test('if the stop script leaves Lumicos running, the backend shuts itself down; the script output goes to a log', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-stop-'));
  const logs = []; let stopped = 0;
  runStopScript(dir, () => stopped++, { platform: 'win32', spawnFn: fakeSpawn((c) => c.emit('exit', 1)), waitMs: 60, log: (l) => logs.push(l), logFile: path.join(dir, 'idle-stop.log') });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(stopped, 1);
  assert.ok(logs.some((l) => /stop script exited \(code 1\)/.test(l)), logs.join('\n'));
  assert.ok(logs.some((l) => /shutting the backend down directly/.test(l)), logs.join('\n'));
  assert.match(fs.readFileSync(path.join(dir, 'idle-stop.log'), 'utf8'), /idle stop \(pid \d+\)/);
});

test('a stop script that cannot start falls back at once, and only once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-stop-'));
  let stopped = 0;
  runStopScript(dir, () => stopped++, { platform: 'win32', spawnFn: fakeSpawn((c) => c.emit('error', new Error('ENOENT'))), waitMs: 50, log: () => {}, logFile: path.join(dir, 'x.log') });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(stopped, 1);
});

test('off Windows the backend just shuts itself down', () => {
  let stopped = 0;
  runStopScript('/nowhere', () => stopped++, { platform: 'linux' });
  assert.equal(stopped, 1);
});

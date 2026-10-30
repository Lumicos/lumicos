// claude-20261023 (Real Chat Check round 9): after a failed run_python call Gemma wrote "เดี๋ยวลองรันใหม่ให้ค่ะ" and
// stopped; Lumicos answered a VAT question without running the matched skill and said she had used a tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runChatReply, DEFAULT_CHARACTER, DEFAULT_SETTINGS, RETRY_NOTES } from '../../.runtime/chat.mjs';

const message = (role, text) => ({ id: randomUUID(), role, parts: [{ type: 'text', text }], createdAt: Date.now(), status: 'done' });
const block = (code) => '```tool\n' + JSON.stringify({ tool: 'run_python', arguments: { code } }) + '\n```';
const PY = { name: 'run_python', permission: 'read', description: 'Run Python', parameters: { type: 'object', properties: { code: { type: 'string' } } } };

async function run(answers, userText, extra = {}) {
  const conv = { id: 'nudge', title: 't', messages: [], createdAt: 1, updatedAt: 1, characterId: DEFAULT_CHARACTER.id };
  const sent = [], executed = [];
  const runtime = {
    provider: { async streamChat(request, cb) { sent.push(JSON.stringify(request.messages)); const a = answers[Math.min(sent.length - 1, answers.length - 1)]; cb?.onToken?.(a); cb?.onDone?.({ stopped: false }); } },
    settings: { ...DEFAULT_SETTINGS, tools: { ...DEFAULT_SETTINGS.tools, mode: 'always' }, memory: { ...DEFAULT_SETTINGS.memory, enabled: false, autoCandidates: false } },
    resolveCharacter: () => DEFAULT_CHARACTER, service: { online: true, tools: [PY] },
    localService: { tools: {
      validate: async () => ({ permission: 'read', preview: { action: 'รัน Python', target: '' } }),
      execute: async (tool, args) => { executed.push(args.code); const ok = !/appliance_cost\(3500, 30\)/.test(args.code);
        return ok ? { summary: 'ok', content: 'exit_code: 0 · 0.3s\n\nstdout:\n{\'baht_total\': 236.25}', data: { exitCode: 0, stdout: "{'baht_total': 236.25}\n" } }
          : { summary: 'error', content: 'exit_code: 1 · 2.1s\n\nstderr:\nValueError: ใช้ minutes_per_day=', data: { exitCode: 1, stdout: '' } }; } } },
    patchConversation: (id, fn) => Object.assign(conv, fn(conv)), patchMessage: (id, mid, fn) => { const i = conv.messages.findIndex((m) => m.id === mid); conv.messages[i] = fn(conv.messages[i]); },
    setGeneratingId() {}, setLastStats() {}, abortRef: { current: null }, imageJobRef: { current: null }, approvals: { current: new Map() }, chatEvents: { emit() {} }, knowledgeContext: null,
    ...extra,
  };
  const history = [message('user', userText)];
  conv.messages = [...history];
  await runChatReply(runtime, conv, history, { id: 'profile', ctx: 8192, capabilities: { tools: true }, generation: DEFAULT_SETTINGS.generation });
  const reply = conv.messages.filter((m) => m.role === 'assistant').at(-1);
  return { sent, executed, text: reply.parts.filter((p) => p.type === 'text').map((p) => p.text).join('').trim() };
}

test('a failed run that the draft promises to redo is sent back once, and the fixed run answers', async () => {
  const r = await run([block('print(appliance_cost(3500, 30))'), 'เดี๋ยวลองรันใหม่ให้ค่ะ', block('print(appliance_cost(3500, minutes_per_day=30))'), 'เดือนละ 236.25 บาทค่ะ'],
    'เครื่องทำน้ำอุ่น 3,500 วัตต์ วันละ 30 นาที ค่าไฟเท่าไหร่');
  assert.equal(r.executed.length, 2);
  assert.ok(r.sent[2].includes('Your last run_python call failed'), 'the third request carries the note');
  assert.equal(r.text, 'เดือนละ 236.25 บาทค่ะ');
});

test('a matched skill whose script never ran gets one reminder; the reminder is not repeated', async () => {
  const script = 'skills/vat-and-discount/script.py';
  const good = await run(['ฉันใช้เครื่องมือคำนวณให้แล้วนะคะ VAT 68.60 บาท', block(`exec(open("${script}", encoding="utf-8").read())\nprint(vat_calc(980))`), 'VAT 68.60 รวม 1,048.60 บาทค่ะ'],
    'คิด VAT 7% ของ 980 บาท', { skillScript: script });
  assert.equal(good.executed.length, 1);
  assert.ok(good.sent[1].includes('its script was not run') && good.sent[1].includes(script));
  assert.equal(good.text, 'VAT 68.60 รวม 1,048.60 บาทค่ะ');
  const stubborn = await run(['VAT 68.60 บาทค่ะ', 'VAT 68.60 บาทค่ะ', 'VAT 68.60 บาทค่ะ'], 'คิด VAT 7% ของ 980 บาท', { skillScript: script });
  assert.equal(stubborn.sent.length, 2, 'one reminder only');
});

test('a claim of tool use with no tool run is written again without it', async () => {
  const r = await run(['ฉันใช้เครื่องมือคำนวณให้แล้วนะคะ ได้ 42', 'ได้ 42 ค่ะ'], 'หกคูณเจ็ดเท่าไหร่');
  assert.equal(r.sent.length, 2);
  assert.ok(r.sent[1].includes('No tool ran in this reply'));
  assert.equal(r.text, 'ได้ 42 ค่ะ');
  const plain = await run(['ได้ 42 ค่ะ'], 'หกคูณเจ็ดเท่าไหร่');
  assert.equal(plain.sent.length, 1, 'ordinary answers are left alone');
});

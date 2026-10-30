import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runChatReply, DEFAULT_CHARACTER, DEFAULT_SETTINGS } from '../../.runtime/chat.mjs';

const message = (role, text) => ({ id: randomUUID(), role, parts: [{ type: 'text', text }], createdAt: Date.now(), status: 'done' });

async function promptFor(text, knowledgeContext) {
  const conv = { id: 'no-web', title: 'No web', messages: [], createdAt: 1, updatedAt: 1, characterId: DEFAULT_CHARACTER.id };
  let sent = '';
  const runtime = {
    provider: { async streamChat(args) { sent = JSON.stringify(args?.messages ?? args); } },
    settings: { ...DEFAULT_SETTINGS, memory: { ...DEFAULT_SETTINGS.memory, enabled: false, autoCandidates: false } },
    resolveCharacter: () => DEFAULT_CHARACTER, service: { online: true, tools: [] }, localService: {},
    patchConversation: (id, fn) => Object.assign(conv, fn(conv)), patchMessage: (id, mid, fn) => { const i = conv.messages.findIndex((m) => m.id === mid); conv.messages[i] = fn(conv.messages[i]); },
    setGeneratingId() {}, setLastStats() {}, abortRef: { current: null }, imageJobRef: { current: null }, approvals: { current: new Map() }, chatEvents: { emit() {} },
    knowledgeContext,
  };
  await runChatReply(runtime, conv, [message('user', text)], { id: 'profile', ctx: 8192, capabilities: { tools: true }, generation: DEFAULT_SETTINGS.generation });
  return sent;
}

test('"ไม่ต้องค้นเว็บ" gets no "could not check online" note (it contains "ค้นเว็บ" but is the opposite request)', async () => {
  const text = 'ไม่ต้องค้นเว็บนะ ตอบจากความรู้เลย ทองคำมีสัญลักษณ์ทางเคมีว่าอะไร';
  for (const ctx of [{ decision: { route: 'DIRECT', reason: 'explicit-no-web' }, evidence: '', citations: [], diagnostics: {} }, null]) {
    const sent = await promptFor(text, ctx);
    assert.ok(sent.length > 0);
    assert.doesNotMatch(sent, /could not check online|Web Search Status/);
  }
});

test('a real web request without evidence still gets the note', async () => {
  const sent = await promptFor('ค้นเว็บ ราคาทองวันนี้', { decision: { route: 'WEB', reason: 'explicit-web-request' }, evidence: '', citations: [], diagnostics: { status: 'timeout' } });
  assert.match(sent, /web search timed out/);
});

test('roleplay never gets the web note, even when the user asks the character to search', async () => {
  const actor = { id: 'mira', name: 'มิร่า', description: 'นักดาบ', personality: '', speakingStyle: '', firstMessage: '', systemPrompt: '', createdAt: 1, updatedAt: 1 };
  const conv = { id: 'rp-web', title: 't', mode: 'roleplay', messages: [], createdAt: 1, updatedAt: 1, characterId: actor.id };
  const sent = [];
  const runtime = {
    provider: { async streamChat(request, cb) { sent.push(JSON.stringify(request.messages ?? request)); cb?.onToken?.('*มิร่าส่ายหน้า*'); cb?.onDone?.({ stopped: false, stats: { tokensGenerated: 1, tokensPerSecond: 1, durationMs: 1, promptTokens: 1 } }); } },
    settings: { ...DEFAULT_SETTINGS, memory: { ...DEFAULT_SETTINGS.memory, enabled: false, autoCandidates: false } },
    resolveCharacter: () => actor, service: { online: true, tools: [] },
    localService: { memory: { retrieve: async () => [], candidates: async () => [] } },
    patchConversation: (id, fn) => Object.assign(conv, fn(conv)), patchMessage: (id, mid, fn) => { const i = conv.messages.findIndex((m) => m.id === mid); conv.messages[i] = fn(conv.messages[i]); },
    setGeneratingId() {}, setLastStats() {}, abortRef: { current: null }, imageJobRef: { current: null }, approvals: { current: new Map() }, chatEvents: { emit() {} },
    knowledgeContext: null, roleplay: { card: 'มิร่า นักดาบ', story: '', appearance: '', recall: () => '' },
  };
  const history = [message('user', 'ช่วยค้นเว็บข่าววันนี้ให้หน่อยสิ')];
  conv.messages = [...history];
  await runChatReply(runtime, conv, history, { id: 'profile', ctx: 8192, capabilities: { tools: true }, generation: DEFAULT_SETTINGS.generation });
  assert.ok(sent.length > 0);
  assert.doesNotMatch(sent.join('\n'), /could not check online|Web Search Status/);
});

test('"ไม่ต้องค้นเว็บ" also takes web_search off the tool list for that turn', async () => {
  const tools = [
    { name: 'web_search', permission: 'read', description: 'WEB-TOOL-MARKER search the internet', parameters: { type: 'object', properties: { query: { type: 'string' } } } },
    { name: 'run_python', permission: 'read', description: 'PY-TOOL-MARKER run Python', parameters: { type: 'object', properties: { code: { type: 'string' } } } },
  ];
  const promptWith = async (text, knowledgeContext) => {
    const conv = { id: 'no-web-tools', title: 't', messages: [], createdAt: 1, updatedAt: 1, characterId: DEFAULT_CHARACTER.id };
    let sent = '';
    const runtime = {
      provider: { async streamChat(args) { sent = JSON.stringify(args?.messages ?? args); } },
      settings: { ...DEFAULT_SETTINGS, tools: { ...DEFAULT_SETTINGS.tools, mode: 'always' }, memory: { ...DEFAULT_SETTINGS.memory, enabled: false, autoCandidates: false } },
      resolveCharacter: () => DEFAULT_CHARACTER, service: { online: true, tools }, localService: {},
      patchConversation: (id, fn) => Object.assign(conv, fn(conv)), patchMessage: (id, mid, fn) => { const i = conv.messages.findIndex((m) => m.id === mid); conv.messages[i] = fn(conv.messages[i]); },
      setGeneratingId() {}, setLastStats() {}, abortRef: { current: null }, imageJobRef: { current: null }, approvals: { current: new Map() }, chatEvents: { emit() {} },
      knowledgeContext,
    };
    await runChatReply(runtime, conv, [message('user', text)], { id: 'profile', ctx: 8192, capabilities: { tools: true }, generation: DEFAULT_SETTINGS.generation });
    return sent;
  };
  const noWeb = await promptWith('ไม่ต้องค้นเว็บนะ ตอบจากความรู้เลย ทองคำมีสัญลักษณ์ทางเคมีว่าอะไร', { decision: { route: 'DIRECT', reason: 'explicit-no-web' }, evidence: '', citations: [], diagnostics: {} });
  assert.match(noWeb, /PY-TOOL-MARKER/, 'other tools stay');
  assert.doesNotMatch(noWeb, /WEB-TOOL-MARKER/);
  const normal = await promptWith('ทองคำมีสัญลักษณ์ทางเคมีว่าอะไร', null);
  assert.match(normal, /WEB-TOOL-MARKER/, 'web_search is still offered on ordinary turns');
});

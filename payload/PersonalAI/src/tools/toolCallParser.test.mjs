// Parser tests. Needs Node 22.18+ (built-in TypeScript type stripping).
// Run: npm run test:parser
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseToolCall, visibleText } from './toolCallParser.ts';

test('fenced tool block', () => {
  const r = parseToolCall('Let me check.\n```tool\n{"tool": "read_file", "arguments": {"path": "notes/a.md"}}\n```');
  assert.equal(r.kind, 'call');
  assert.deepEqual(r.call, { tool: 'read_file', args: { path: 'notes/a.md' } });
  assert.equal(r.before, 'Let me check.');
});

test('<tool_call> tag with name + string arguments', () => {
  const r = parseToolCall('<tool_call>{"name":"list_files","arguments":"{\\"path\\":\\"notes\\"}"}</tool_call>');
  assert.deepEqual(r.call, { tool: 'list_files', args: { path: 'notes' } });
});

test('bare JSON reply', () => {
  const r = parseToolCall('{"tool":"search_files","args":{"query":"Gemma"}}');
  assert.deepEqual(r.call, { tool: 'search_files', args: { query: 'Gemma' } });
});

test('nested braces and strings with braces', () => {
  const r = parseToolCall('```tool\n{"tool":"create_file","arguments":{"path":"a.json","content":"{\\"x\\": {\\"y\\": 1}}"}}\n```');
  assert.equal(r.kind, 'call');
  assert.equal(r.call.args.content, '{"x": {"y": 1}}');
});

test('trailing commas are tolerated', () => {
  const r = parseToolCall('```tool\n{"tool":"list_files","arguments":{"path":"",},}\n```');
  assert.equal(r.kind, 'call');
});

test('malformed JSON is reported, not executed', () => {
  const r = parseToolCall('```tool\n{"tool": "delete_file", "arguments": {path: notes}}\n```');
  assert.equal(r.kind, 'malformed');
});

test('missing tool name is malformed', () => {
  const r = parseToolCall('```tool\n{"arguments": {"path": "x"}}\n```');
  assert.equal(r.kind, 'malformed');
});

test('normal text and ordinary code blocks are not tool calls', () => {
  assert.equal(parseToolCall('Here is some JSON:\n```json\n{"a": 1}\n```').kind, 'none');
  assert.equal(parseToolCall('à¸ªà¸§à¸±à¸ªà¸”à¸µà¸„à¹ˆà¸° à¸§à¸±à¸™à¸™à¸µà¹‰à¹€à¸›à¹‡à¸™à¸¢à¸±à¸‡à¹„à¸‡à¸šà¹‰à¸²à¸‡').kind, 'none');
});

test('visibleText hides tool blocks, even half-streamed', () => {
  assert.equal(visibleText('Sure!\n```tool\n{"tool": "rea'), 'Sure!');
  assert.equal(visibleText('Sure!\n``'), 'Sure!');
  assert.equal(visibleText('Sure! <tool_'), 'Sure!');
  assert.equal(visibleText('No tools here.'), 'No tools here.');
});


test('Gemma native read_attachment tool call', () => {
  const input = '<|tool_call>call:read_attachment{"attachment_id":"test-123"}<tool_call|>';
  const result = parseToolCall(input);

  assert.equal(result.kind, 'call');
  if (result.kind === 'call') {
    assert.equal(result.call.tool, 'read_attachment');
    assert.deepEqual(result.call.args, { attachment_id: 'test-123' });
  }
  assert.equal(visibleText(input), '');
});

test('Gemma incomplete tool call is not executed', () => {
  const result = parseToolCall(
    '<|tool_call>call:read_attachment{"attachment_id":'
  );
  assert.equal(result.kind, 'malformed');
});


test('Gemma wrapped JSON request from PDF UI regression', () => {
  const raw = '<|tool_call>call:\n{"tool":"read_file","arguments":{"path":"J4.pdf","query":"text at top and bottom"}}\n';
  const r = parseToolCall(raw);
  assert.equal(r.kind, 'call');
  assert.deepEqual(r.call, {tool:'read_file',args:{path:'J4.pdf',query:'text at top and bottom'}});
});
test('Gemma broken wrapped request is reported instead of a blank answer', () => {
  assert.equal(parseToolCall('<|tool_call>call:').kind, 'malformed');
  assert.equal(parseToolCall('<|tool_call>call: {"tool":').kind, 'malformed');
});
test('Gemma native closing token belongs to the parsed call', () => {
  const raw='<|tool_call>call:read_attachment{"attachment_id":"x"}<tool_call|>';
  assert.equal(parseToolCall(raw).raw,raw);
});
test('Gemma web search wrapper without colon keeps validated arguments',()=>{
 const r=parseToolCall('<|tool_call>call\n{"tool":"web_search","arguments":{"query":"เชียงใหม่","limit":3}}\n');
 assert.equal(r.kind,'call');assert.deepEqual(r.call,{tool:'web_search',args:{query:'เชียงใหม่',limit:3}});
 assert.equal(parseToolCall('<|tool_call>call\n{"tool":').kind,'malformed');
});

test('legacy image tool aliases normalize to generate_image',()=>{
 for (const name of ['image_generator','Z image','create_image','generate_image']) {
  const r=parseToolCall('```tool\n'+JSON.stringify({tool:name,arguments:{prompt:'a cat'}})+'\n```');
  assert.equal(r.kind,'call');
  assert.equal(r.call.tool,'generate_image');
 }
});

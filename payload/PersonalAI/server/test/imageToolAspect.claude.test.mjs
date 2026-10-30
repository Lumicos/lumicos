import test from 'node:test';
import assert from 'node:assert/strict';
import { imageTools } from '../tools/imageTools.mjs';

const make = () => { const calls = []; const tool = imageTools({ create: async a => { calls.push(a); return { id: 'j', status: 'queued' }; } })[0]; return { calls, tool }; };

test('aspect picks the picture shape; default is portrait', async () => {
  const { calls, tool } = make();
  await tool.handler({ prompt: 'a lake', aspect: 'landscape' });
  await tool.handler({ prompt: 'a girl' });
  await tool.handler({ prompt: 'x', aspect: 'bogus' });
  assert.deepEqual([calls[0].width, calls[0].height], [1024, 576]);
  assert.deepEqual([calls[1].width, calls[1].height], [768, 1024]);
  assert.deepEqual([calls[2].width, calls[2].height], [768, 1024]);
});

test('explicit width/height (user ratio) override aspect', async () => {
  const { calls, tool } = make();
  await tool.handler({ prompt: 'a', aspect: 'landscape', width: 768, height: 768 });
  assert.deepEqual([calls[0].width, calls[0].height], [768, 768]);
});

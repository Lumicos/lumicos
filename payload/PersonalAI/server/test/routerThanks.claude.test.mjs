// claude-20261024: "ขอบใจนะ" / "ขอบคุณนะ" alone went to a library search (LOCAL auto-knowledge) and Lumicos answered
// "รับทราบค่ะ"; "โอเค ขอบใจนะ" was already a direct reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicKnowledgeRouter as KnowledgeRouter } from '../knowledge/router/router.mjs';

test('a message that is only thanks is answered directly, thanks with a request is not', () => {
  const router = new KnowledgeRouter();
  for (const q of ['ขอบใจนะ', 'ขอบคุณนะ', 'ขอบคุณมาก ๆ เลยค่ะ 🙏', 'โอเค ขอบใจนะ', 'ขอบคุณครับ!'])
    assert.equal(router.route({ query: q }).route, 'DIRECT', q);
  assert.notEqual(router.route({ query: 'ขอบคุณนะ ช่วยค้นเว็บราคาทองวันนี้ต่อหน่อย' }).reason, 'direct-pattern');
});

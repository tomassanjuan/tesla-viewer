import test from 'node:test';
import assert from 'node:assert/strict';
import { versionLink, REPO } from '../js/version.js';

test('links to the commit when a sha is known', () => {
  const l = versionLink({ version: '0.1.0', sha: 'abcdef1234567890abcdef1234567890abcdef12' });
  assert.equal(l.text, 'v0.1.0 · abcdef1');
  assert.equal(l.href, `${REPO}/commit/abcdef1234567890abcdef1234567890abcdef12`);
});
test('falls back to the repo without a sha or file', () => {
  assert.deepEqual(versionLink({ version: '0.1.0', sha: '' }), { text: 'v0.1.0', href: REPO });
  assert.deepEqual(versionLink(null), { text: 'dev', href: REPO });
  assert.equal(versionLink({ sha: '"><x' }).href, REPO);
});

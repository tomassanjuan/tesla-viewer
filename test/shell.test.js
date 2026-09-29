import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('service worker SHELL caches every js module', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const files = ['js', 'js/locales'].flatMap((d) => readdirSync(new URL(`../${d}`, import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`));
  for (const f of files) assert.ok(sw.includes(`'${f}'`), `${f} missing from sw.js SHELL`);
});

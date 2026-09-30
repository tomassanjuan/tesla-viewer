import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('service worker SHELL caches every js module', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const files = ['js', 'js/locales'].flatMap((d) => readdirSync(new URL(`../${d}`, import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`));
  for (const f of files) assert.ok(sw.includes(`'${f}'`), `${f} missing from sw.js SHELL`);
});

test('phone layout: markup hooks exist and the JS/CSS phone media queries match', () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const html = read('index.html'), css = read('style.css'), app = read('js/app.js');
  for (const id of ['mbar', 'menuBtn', 'scrim']) assert.ok(html.includes(`id="${id}"`), `#${id} missing from index.html`);
  assert.ok(html.includes('viewport-fit=cover'));
  const q = app.match(/matchMedia\?\.\('([^']+)'\)/)?.[1];
  assert.ok(q, 'PHONE media query not found in app.js');
  assert.ok(css.includes(`@media ${q}{`), 'style.css phone media query out of sync with app.js PHONE');
});

test('version badge and language chips live in the always-visible top bar, not the sidebar', () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const html = read('index.html');
  const bar = html.match(/<div id="mbar">.*?<\/div>/s)?.[0] ?? '';
  const side = html.match(/<aside id="side".*?<\/aside>/s)?.[0] ?? '';
  assert.ok(bar.includes('id="ver"') && !side.includes('id="ver"'), '#ver must be in #mbar only');
  assert.ok(read('js/i18n.js').includes("getElementById('mbar')") && !read('js/i18n.js').includes('extras-side'), 'language chips mount into #mbar');
  assert.ok(!/#mbar\{display:none/.test(read('style.css').replace(/\s/g, '')), '#mbar must not be hidden on desktop');
});

test('desktop polish is scoped to a media query that excludes the phone layout, and library styling lives in CSS', () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const css = read('style.css'), app = read('js/app.js');
  const block = css.slice(css.indexOf('UI polish: desktop header'));
  assert.ok(block.includes('@media (min-width:861px) and (not ((orientation:landscape) and (max-height:520px) and (max-width:1000px))){'), 'desktop block must exclude the phone media query');
  assert.ok(block.includes('.dock-row{display:grid'), 'dock is a two-row grid on desktop');
  assert.ok(!/style\.cssText = 'display:block;grid-column/.test(app) && app.includes("im.className = 'ev-thumb'"), 'thumbnail styling belongs in CSS (.ev-thumb)');
  assert.ok(css.includes('.ev-thumb{') && css.includes('.cat .n{'), 'thumb and chip-count styles exist');
});

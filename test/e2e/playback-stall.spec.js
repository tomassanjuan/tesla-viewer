// Multi-camera playback when one camera stalls, errors or never starts. Uses real (WebM) video so the browser's
// media pipeline runs; a stall is simulated by freezing one element's clock (what a starved decoder looks like:
// not paused, readyState 2, currentTime stuck).
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordWebm } from './webm.js';

const TS = '2026-03-02_10-00-00', CAMS = ['front', 'back', 'left_repeater'];
let root, folder, badFront;
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage(); await page.goto('about:blank');
  const clip = await recordWebm(page, 14); await page.close();
  root = mkdtempSync(join(tmpdir(), 'tv-stall-'));
  folder = join(root, 'TeslaCam'); const d = join(folder, 'SavedClips', TS); mkdirSync(d, { recursive: true });
  for (const c of CAMS) writeFileSync(join(d, `${TS}-${c}.mp4`), clip);
  writeFileSync(join(d, 'event.json'), JSON.stringify({ reason: 'user_interaction_honk', city: 'Madrid' }));
  // same event, but the front camera (the master by default) is undecodable garbage
  badFront = join(root, 'bad', 'TeslaCam'); const b = join(badFront, 'SavedClips', TS); mkdirSync(b, { recursive: true });
  for (const c of CAMS) writeFileSync(join(b, `${TS}-${c}.mp4`), c === 'front' ? Buffer.alloc(4096, 7) : clip);
  writeFileSync(join(b, 'event.json'), JSON.stringify({ reason: 'user_interaction_honk', city: 'Madrid' }));
});
test.afterAll(() => rmSync(root, { recursive: true, force: true }));

const times = (page) => page.evaluate(() => [...document.querySelectorAll('#grid video')].map((v) => v.currentTime));
const states = (page) => page.locator('#grid .cam').evaluateAll((els) => els.map((e) => e.dataset.state));
// freeze video #i: clock stuck, not paused; `heal` = a seek un-freezes it (a stalled decoder that a re-seek revives)
const freeze = (page, i, heal = false) => page.evaluate(([i, heal]) => {
  const v = document.querySelectorAll('#grid video')[i], real = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
  let t = v.currentTime, frozen = true;
  Object.defineProperty(v, 'currentTime', { get: () => (frozen ? t : real.get.call(v)), set(x) { if (heal) { window.__healed = true; frozen = false; delete v.readyState; } real.set.call(v, x); } });
  Object.defineProperty(v, 'readyState', { get: () => 2, configurable: true });
}, [i, heal]);

const start = async (page, dir) => {
  await page.goto('/index.html');
  await page.locator('#pickDir').setInputFiles(dir);
  await expect(page.locator('#grid .cam')).toHaveCount(3);
  await expect(page.locator('#busy')).toBeHidden();
  await page.locator('#play').click();
  await expect.poll(async () => (await times(page))[2], { timeout: 8000 }).toBeGreaterThan(0.8);
};
test.beforeEach(({ page }, info) => (info.title.includes('never loads') ? undefined : start(page, folder)));

test('frozen master (front): the followers keep playing forward instead of looping back to its frozen time', async ({ page }) => {
  await freeze(page, 0);
  const frozenAt = (await times(page))[0];
  const seen = [];
  for (let i = 0; i < 16; i++) { await page.waitForTimeout(500); seen.push((await times(page))[1]); }
  // main looped the follower back to frozenAt every ~0.5 s (max - min of a loop stays under ~1 s): it must advance well past it, and never jump back
  expect(seen.at(-1)).toBeGreaterThan(frozenAt + 4);
  for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1] - 0.3);
  // the frozen cam is flagged, the healthy ones are not
  expect((await states(page))[0]).toBe('error');
  expect((await states(page)).slice(1)).toEqual(['playing', 'playing']);
  await expect(page.locator('#grid .cam').first().locator('.cam-state')).toHaveText('Playback error');
  // and the clock in the transport bar follows a healthy cam
  const clock = async () => (await page.locator('#time').textContent()).split(' / ')[0];
  const a = await clock(); await page.waitForTimeout(2200); expect(await clock()).not.toBe(a);
});

test('a stalled follower is re-seeked and resumed once by itself, without error', async ({ page }) => {
  await freeze(page, 1, true);
  await expect.poll(() => page.evaluate(() => window.__healed), { timeout: 8000 }).toBe(true);   // the app re-seeked it itself
  await expect.poll(() => states(page), { timeout: 8000 }).toEqual(['playing', 'playing', 'playing']);
  await expect(page.locator('#grid .cam-state:not(:empty)')).toHaveCount(0);
  const [f, b] = await times(page); expect(Math.abs(f - b)).toBeLessThan(1);
});

test('stats readout names each camera state: playing shows drop %, stalled/error show the state', async ({ page }) => {
  await page.locator('#perfBtn').click();
  const out = page.locator('.perf-out');
  await expect(out).toContainText('back            drop');
  await freeze(page, 1);
  await expect(out).toContainText(/back\s+(buffering|stalled)/, { timeout: 5000 });
  await expect(out).toContainText(/back\s+error/, { timeout: 9000 });
  await expect(out).toContainText('front           drop');
  await expect(out).not.toContainText('paused');
});

test('a master camera that never loads does not pin the followers to time 0', async ({ page }) => {
  await start(page, badFront);
  await expect.poll(() => states(page), { timeout: 12000 }).toEqual(['error', 'playing', 'playing']);
  await page.waitForTimeout(3000);
  const seen = [];
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(500); seen.push((await times(page))[1]); }
  expect(seen.at(-1)).toBeGreaterThan(seen[0] + 1.5);
  for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1] - 0.3);
});

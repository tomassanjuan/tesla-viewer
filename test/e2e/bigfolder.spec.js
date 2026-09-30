// A whole TeslaCam copied from macOS: thousands of files incl. AppleDouble `._*.mp4` sidecars, empty and garbage clips.
// Regression: sidecars were parsed as clips (and replaced the real file), so every tile stayed black with no message.
import { test, expect } from '@playwright/test';
import { recordWebm } from './webm.js';
import { makeClip } from './fixtures.js';

const N_OLD = 300, CAMS = ['front', 'back', 'left_repeater'];
const ts = (i) => { const d = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 3600e3); const p = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}_${p(d.getUTCHours())}-${p(d.getUTCMinutes())}-00`; };
const appleDouble = () => { const b = Buffer.alloc(4096); b.writeUInt32BE(0x00051607, 0); return b; };
let files, T;
// <input webkitdirectory> only takes a path in Playwright, and disk order can't put sidecars after the real file, so build the FileList in the page.
const drop = (page, list) => page.evaluate((items) => {
  const dt = new DataTransfer();
  for (const { name, b64 } of items) dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type: 'video/mp4' }));
  const i = document.getElementById('pickDir'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true }));
}, list.map((f) => ({ name: f.name, b64: f.buffer.toString('base64') })));
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage(); await page.goto('about:blank');
  const clip = await recordWebm(page, 8); await page.close();
  T = '2026-09-04_18-16-03';
  const f = (name, buffer) => ({ name, mimeType: name.endsWith('.json') ? 'application/json' : 'video/mp4', buffer });
  files = [];
  for (const c of CAMS) files.push(f(`${T}-${c}.mp4`, clip));                       // the real clip, listed first ...
  for (const c of CAMS) files.push(f(`._${T}-${c}.mp4`, appleDouble()));            // ... so its sidecar is seen last and used to replace it
  for (let i = 0; i < N_OLD; i++) {
    files.push(f(`${ts(i)}-front.mp4`, makeClip({ frames: 5 })));
    files.push(f(`._${ts(i)}-front.mp4`, appleDouble()));
    files.push(f(`._${ts(i + 1000)}-back.mp4`, appleDouble()));                     // sidecar whose clip does not exist
    files.push(f(`${ts(i + 2000)}-back.mp4`, Buffer.alloc(0)));                      // truncated to nothing
  }
  files.push(f('.DS_Store', Buffer.alloc(6148)));
});

test('sidecars and empty files are ignored silently; the real clip loads and every tile shows video', async ({ page }) => {
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.addInitScript(() => {   // record head-probe reads (probeSei reads 16-byte heads) made while the app is busy loading a clip
    window.__probeWhileBusy = 0; const slice = Blob.prototype.slice;
    Blob.prototype.slice = function (a, b, ...r) { if (b - a === 16 && document.getElementById('busy') && !document.getElementById('busy').hidden && /Loading video|Reading telemetry/.test(document.getElementById('busy').textContent)) window.__probeWhileBusy++; return slice.call(this, a, b, ...r); };
  });
  await page.goto('/index.html');
  await drop(page, files);
  await expect(page.locator('#grid .cam')).toHaveCount(3);
  await expect(page.locator('#events .ev')).toHaveCount(N_OLD + 1);   // sidecars/empty files add no phantom clips
  await expect(page.locator('#busy')).toBeHidden({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('#grid video')].map((v) => v.readyState >= 2 && v.videoWidth > 0)), { timeout: 15000 }).toEqual([true, true, true]);
  for (const b of await page.locator('#grid .cam').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) { expect(b.width).toBeGreaterThan(50); expect(b.height).toBeGreaterThan(50); }
  expect(logs.filter((l) => /shorter than the 8 KiB/.test(l))).toEqual([]);
  expect(await page.evaluate(() => window.__probeWhileBusy)).toBe(0);
  await expect(page.locator('#vidwarn')).toHaveText('');
});

test('a camera that cannot load says so on its tile instead of staying silently black', async ({ page }) => {
  const bad = [{ name: `${T}-front.mp4`, mimeType: 'video/mp4', buffer: Buffer.alloc(20000, 7) }, { name: `${T}-back.mp4`, mimeType: 'video/mp4', buffer: files[1].buffer }];
  await page.goto('/index.html?loadms=2500');
  await drop(page, bad);
  await expect(page.locator('#grid .cam')).toHaveCount(2);
  await expect(page.locator('#grid .cam[data-state="error"] .cam-state')).toHaveText('Playback error', { timeout: 12000 });
  await expect(page.locator('#vidwarn')).toContainText('Front');
});

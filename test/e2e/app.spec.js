import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeTeslaCam, writeTelemetryEdges, writeTurnTrip, TURN_TRIP } from './fixtures.js';

let root, folder;
test.beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'tv-e2e-')); folder = writeTeslaCam(root); });
test.afterAll(() => rmSync(root, { recursive: true, force: true }));

// Collect console errors / uncaught exceptions; the app must load and run clean.
test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(`console: ${m.text()}`); });
  // version.json is written at deploy time (scripts/version.mjs); the app falls back gracefully without it
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/version.json')) page.errors.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto('/index.html');
});
test.afterEach(({ page }) => expect(page.errors, 'console errors').toEqual([]));

const load = async (page) => {
  await page.locator('#pickDir').setInputFiles(folder);
  await expect(page.locator('#events .ev').first()).toBeVisible();
};
const evt = (page, text) => page.locator('#events .ev', { hasText: text });
const chip = (page, sel, text) => page.locator(`${sel} button`, { hasText: text });
// #layout/#units/#groupby are <select>s or button groups (js/seg.js); both expose .value, so drive them either way.
const setOpt = async (page, id, v) => {
  if (/groupby|sortby/.test(id)) await page.locator('#libopts').evaluate((d) => { d.open = true; });
  const b = page.locator(`${id} [data-v="${v}"]`);
  if (await b.count()) await b.click(); else await page.locator(id).selectOption(v);
};
const optValue = (page, id) => page.locator(id).evaluate((el) => el.value);
const open = async (page, text) => { await evt(page, text).click(); await expect(evt(page, text)).toHaveClass(/\bon\b/); };

test('page loads with the drop zone and no library', async ({ page }) => {
  await expect(page).toHaveTitle(/Tesla Viewer/);
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.getByText('Drop your TeslaCam folder here')).toBeVisible();
  await expect(page.locator('#events .ev')).toHaveCount(0);
});

test('opening a folder lists trips and events and shows the first one', async ({ page }) => {
  await load(page);
  // 1 trip + saved + sentry + honk (big moov) event
  await expect(page.locator('#events .ev')).toHaveCount(4);
  await expect(page.locator('#empty')).toBeHidden();
  await expect(page.locator('#grid .cam').first()).toBeVisible();
});

test('camera grid: 6 cameras in a 3x2 spatial layout, 4 in a 3x2 without pillars', async ({ page }) => {
  await load(page);
  await open(page, '2026-03-02_10-00-00');
  await expect(page.locator('#grid .cam')).toHaveCount(6);
  const box = async (name) => (await page.locator('#grid .cam', { hasText: name }).boundingBox());
  const [front, back, left, right, lp, rp] = await Promise.all(['Front', 'Back', 'Left', 'Right', 'L pillar', 'R pillar'].map(box));
  // pillars flank the front camera on the top row, repeaters flank the back camera on the bottom row
  expect(Math.abs(lp.y - front.y)).toBeLessThan(2); expect(lp.x).toBeLessThan(front.x); expect(rp.x).toBeGreaterThan(front.x);
  expect(Math.abs(left.y - back.y)).toBeLessThan(2); expect(left.x).toBeLessThan(back.x); expect(right.x).toBeGreaterThan(back.x);
  expect(back.y).toBeGreaterThan(front.y);

  await open(page, '2026-03-03_22-00-00');
  await expect(page.locator('#grid .cam')).toHaveCount(4);
});

test('click a camera to enlarge it and click again to restore the grid', async ({ page }) => {
  await load(page);
  await open(page, '2026-03-02_10-00-00');
  const back = page.locator('#grid .cam', { hasText: 'Back' });
  await back.click();
  await expect(page.locator('#grid')).toHaveClass(/\bfocus\b/);
  await expect(back).toHaveClass(/\bmain\b/);
  expect(await optValue(page, '#layout')).toBe('focus');
  await back.click();
  await expect(page.locator('#grid')).not.toHaveClass(/\bfocus\b/);
  expect(await optValue(page, '#layout')).toBe('auto');
});

test('event-type chips filter the library', async ({ page }) => {
  await load(page);
  await expect(chip(page, '#evtype', 'Saved by you')).toBeVisible();
  await chip(page, '#evtype', /Person|Sentry/).click();
  await expect(page.locator('#events .ev')).toHaveCount(1);
  await expect(evt(page, '2026-03-03_22-00-00')).toBeVisible();
  await chip(page, '#evtype', 'Honk').click();
  await expect(page.locator('#events .ev')).toHaveCount(1);
  await expect(evt(page, '2026-03-04_09-00-00')).toBeVisible();
  await chip(page, '#evtype', 'Honk').click();   // toggle off
  await expect(page.locator('#events .ev')).toHaveCount(4);
});

test('category tabs filter the library', async ({ page }) => {
  await load(page);
  await chip(page, '#cats', 'Recent').click();
  await expect(page.locator('#events .ev')).toHaveCount(1);
  await chip(page, '#cats', 'Saved').click();
  await expect(page.locator('#events .ev')).toHaveCount(2);
  await chip(page, '#cats', 'All').click();
  await expect(page.locator('#events .ev')).toHaveCount(4);
});

test('group by day / city / none', async ({ page }) => {
  await load(page);
  const heads = page.locator('#events h3.evgroup');
  await expect(heads).toHaveCount(4);                 // default: one day each
  await setOpt(page, '#groupby', 'city');
  await expect(heads).toHaveText(["Madrid2", "Paris1", "Unknown1"]);   // trip has no event.json city
  await setOpt(page, '#groupby', 'none');
  await expect(heads).toHaveCount(0);
  await expect(page.locator('#events .ev')).toHaveCount(4);
});

test('group by type / month and sort; choices persist across reloads; headers collapse', async ({ page }) => {
  await load(page);
  await setOpt(page, '#groupby', 'type');
  await expect(page.locator('#events h3.evgroup').first()).toBeVisible();
  const n = await page.locator('#events h3.evgroup').count();
  expect(n).toBeGreaterThan(1);
  await setOpt(page, '#groupby', 'month');
  await expect(page.locator('#events h3.evgroup')).toHaveCount(1);
  const head = page.locator('#events h3.evgroup button').first();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#events .ev:visible')).toHaveCount(0);
  await head.click();
  await expect(page.locator('#events .ev:visible')).toHaveCount(4);
  await setOpt(page, '#sortby', 'oldest');
  const first = await page.locator('#events .ev').first().innerText();
  await setOpt(page, '#sortby', 'newest');
  expect(await page.locator('#events .ev').first().innerText()).not.toBe(first);
  await setOpt(page, '#sortby', 'oldest');
  await page.reload();
  await load(page);
  expect(await optValue(page, '#groupby')).toBe('month');
  expect(await optValue(page, '#sortby')).toBe('oldest');
});

test('telemetry badge: SEI clips (incl. a 3 MB moov) show it, clips without SEI do not', async ({ page }) => {
  await load(page);
  // the badge is probed lazily once an event scrolls into view
  for (const el of await page.locator('#events .ev').all()) await el.scrollIntoViewIfNeeded();
  await expect(evt(page, '2026-03-04_09-00-00').locator('.tele')).toBeVisible();   // big moov
  await expect(evt(page, '2026-03-02_10-00-00').locator('.tele')).toBeVisible();
  await expect(page.locator('#events .ev', { hasText: 'Trip' }).locator('.tele')).toBeVisible();
  await expect(evt(page, '2026-03-03_22-00-00').locator('.tele')).toHaveCount(0);
});

test('telemetry badge: SEI after a big first slice, or on a non-front cam, still shows it', async ({ page }) => {
  const edges = mkdtempSync(join(tmpdir(), 'tv-e2e-edges-'));
  await page.locator('#pickDir').setInputFiles(writeTelemetryEdges(edges));
  await expect(page.locator('#events .ev').first()).toBeVisible();
  for (const el of await page.locator('#events .ev').all()) await el.scrollIntoViewIfNeeded();
  await expect(evt(page, '2026-03-05_09-00-00').locator('.tele')).toBeVisible();
  await expect(evt(page, '2026-03-06_09-00-00').locator('.tele')).toBeVisible();
  rmSync(edges, { recursive: true, force: true });
});

test('big moov clip parses and shows telemetry HUD', async ({ page }) => {
  await load(page);
  await open(page, '2026-03-04_09-00-00');
  await expect(page.locator('#grid .cam')).toHaveCount(1);
  await expect(page.locator('#hud')).toBeVisible();
  await page.locator('#stepF').click();   // the HUD is drawn on the first playhead update
  await expect(page.locator('#hud .h-speed b')).toHaveText(/^\d+$/);
  await expect(page.locator('#status')).toHaveText('');
});

test('clip without SEI opens with no HUD', async ({ page }) => {
  await load(page);
  await open(page, '2026-03-03_22-00-00');
  await expect(page.locator('#grid .cam')).toHaveCount(4);
  await expect(page.locator('#hud')).toBeHidden();
});

test('parsed clips are cached in IndexedDB and reused after a reload', async ({ page }) => {
  await load(page);
  await open(page, '2026-03-02_10-00-00');
  await expect(page.locator('#hud')).toBeVisible();
  await open(page, '2026-03-03_22-00-00');              // no SEI: proven from the head, cached as "no telemetry"
  await expect(page.locator('#hud')).toBeHidden();
  const n = () => page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('tv-telemetry');
    r.onsuccess = () => { const c = r.result.transaction('clips').objectStore('clips').count(); c.onsuccess = () => res(c.result); };
  }));
  await expect.poll(n).toBeGreaterThanOrEqual(2);
  await page.reload();
  await load(page);
  await open(page, '2026-03-02_10-00-00');              // second visit: served from the cache, same telemetry
  await expect(page.locator('#hud')).toBeVisible();
  await page.locator('#stepF').click();
  await expect(page.locator('#hud .h-speed b')).toHaveText(/^\d+$/);
});

test('telemetry HUD follows the playhead and the units switch', async ({ page }) => {
  await load(page);
  await open(page, '2026-03-02_10-00-00');
  await expect(page.locator('#hud')).toBeVisible();
  const speed = () => page.locator('#hud .h-speed b').textContent().then(Number);
  await page.locator('#stepF').click();   // the HUD is drawn on the first playhead update
  await expect(page.locator('#hud .h-speed small')).toHaveText('km/h');
  const kmh = await speed();
  expect(kmh).toBeGreaterThan(0);
  await setOpt(page, '#units', 'mph');
  await expect(page.locator('#hud .h-speed small')).toHaveText('mph');
  expect(await speed()).toBeLessThan(kmh);
});

test('graph scrubbing seeks the playhead', async ({ page }) => {
  await load(page);
  await open(page, '2026-03-02_10-00-00');
  await expect(page.locator('#hud')).toBeVisible();
  const time = page.locator('#time');
  await expect(time).toHaveText(/^0:00 \/ /);
  const g = await page.locator('#graph').boundingBox();
  await page.mouse.click(g.x + g.width * 0.9, g.y + g.height / 2);
  // synthetic clips are not decodable, so the playhead lands on the start of the clicked segment (2nd of 2 = 50%)
  await expect(async () => {
    const seek = +(await page.locator('#seek').inputValue());
    expect(seek).toBeGreaterThanOrEqual(500);
  }).toPass();
  await page.locator('#seek').fill('0');
  await page.locator('#seek').dispatchEvent('input');
  await expect(async () => expect(+(await page.locator('#seek').inputValue())).toBe(0)).toPass();
});

test('dashboard view hides the cameras and keeps telemetry', async ({ page }) => {
  await load(page);
  await open(page, '2026-03-02_10-00-00');
  if (!(await page.locator('#layout [data-v="dash"]').count())) test.skip(true, 'no dashboard view in this build');
  await setOpt(page, '#layout', 'dash');
  expect(await optValue(page, '#layout')).toBe('dash');
  await expect(page.locator('#grid')).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();
  await setOpt(page, '#layout', 'auto');
  await expect(page.locator('#grid')).toBeVisible();
});

test('CSV export downloads the telemetry', async ({ page }) => {
  await load(page);
  await open(page, '2026-03-02_10-00-00');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#csv').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.csv$/);
});

test('keyboard shortcuts help toggles', async ({ page }) => {
  await page.locator('#helpBtn').click();
  await expect(page.locator('#help')).toBeVisible();
});

test('timeline ticks sit where the telemetry event happens (multi-clip trip)', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'tv-turn-'));
  try {
    await page.locator('#pickDir').setInputFiles(writeTurnTrip(dir));
    await expect(page.locator('#events .ev').first()).toBeVisible();
    await expect(page.locator('.ins-tick.turn')).toHaveCount(3);
    const total = 30; // 3 clips x 10 s
    // clip 2 and 3 offsets are added: peaks at 0:05, 0:12 and 0:28 of the whole trip
    expect(await page.locator('.ins-tick.turn').evaluateAll((els) => els.map((e) => e.title.slice(-4)))).toEqual(['0:05', '0:12', '0:28']);
    const xs = await page.locator('.ins-tick.turn').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return r.x + r.width / 2; }));
    // the range thumb's centre for value v travels the track minus one thumb width: that is where the playhead is drawn
    for (const [i, t] of TURN_TRIP.spikes.entries()) {
      await page.locator('#seek').evaluate((el, v) => { el.value = v; }, (t / total) * 1000);
      const thumb = await page.locator('#seek').evaluate((el) => { const r = el.getBoundingClientRect(), tw = 16; /* desktop thumb width, style.css */ return r.x + tw / 2 + (r.width - tw) * (el.value / 1000); });
      expect(Math.abs(xs[i] - thumb), `tick ${i} at ${t}s`).toBeLessThan(2);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sidebar toggle keeps the main area full width, with and without a resized sidebar', async ({ page }) => {
  const main = () => page.locator('main').evaluate((el) => Math.round(el.getBoundingClientRect().width));
  const toggle = page.locator('#sideToggle');
  const vw = 1280;
  for (const side of [300, 460]) {
    await page.evaluate((w) => document.documentElement.style.setProperty('--side-w', w + 'px'), side);
    expect(await main()).toBeGreaterThan(vw - side - 4);
    await toggle.click();
    await expect(page.locator('html')).toHaveClass(/side-off/);
    expect(await main()).toBeGreaterThan(vw - 4);
    await toggle.click();
    await expect(page.locator('html')).not.toHaveClass(/side-off/);
    expect(await main()).toBeGreaterThan(vw - side - 4);
    expect(await main()).toBeLessThan(vw - side + 4);
  }
});

test('collapsed sidebar persists across reload with a saved width', async ({ page }) => {
  await page.evaluate(() => { localStorage.setItem('tv-side', '0'); localStorage.setItem('tv-side-w', '420'); });
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/side-off/);
  expect(await page.locator('main').evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(1270);
});

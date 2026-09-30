import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeTeslaCam, writeTelemetryEdges, writeTurnTrip, TURN_TRIP, writeAebEvent, AEB_EVENT } from './fixtures.js';

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
const chip = (page, sel, text) => (sel === '#evtype' ? page.locator(`${sel} button`).and(page.getByLabel(text)) : page.locator(`${sel} button`, { hasText: text }));
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
  await page.setViewportSize({ width: 1280, height: 1100 }); // tall enough that the car-shaped grid is the best fit (short stages switch to a big-front arrangement)
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
  await chip(page, '#evtype', /Person or object/).click();
  await expect(page.locator('#events .ev')).toHaveCount(1);
  await expect(evt(page, '2026-03-03_22-00-00')).toBeVisible();
  await chip(page, '#evtype', 'Honk').click();
  await expect(page.locator('#events .ev')).toHaveCount(1);
  await expect(evt(page, '2026-03-04_09-00-00')).toBeVisible();
  await chip(page, '#evtype', 'Honk').click();   // toggle off
  await expect(page.locator('#events .ev')).toHaveCount(4);
});

test('type chips are icons only: no visible text, name in title and aria-label', async ({ page }) => {
  await load(page);
  const honk = chip(page, '#evtype', 'Honk');
  await expect(honk.locator('svg.tic')).toBeVisible();
  await expect(honk).toHaveAttribute('title', 'Honk');
  await expect(honk).toHaveText(/^\s*1\s*$/);   // the count only
  await honk.click();
  await expect(page.locator('#evhint')).toHaveText('Honk');
  await expect(page.locator('#events .ev small .ic-ty').first()).toHaveAttribute('aria-label', 'Honk');
});

test('telemetry chip filters to clips with telemetry and combines with the other filters', async ({ page }) => {
  await load(page);
  const tele = page.locator('#cats .cat-tele');
  await expect(tele.locator('.n')).toHaveText('3');   // fills in once the background probe is done (no "…")
  await tele.click();
  await expect(page.locator('#events .ev')).toHaveCount(3);
  await expect(evt(page, '2026-03-03_22-00-00')).toHaveCount(0);   // sentry clip without SEI
  await chip(page, '#cats', 'Saved').click();
  await expect(page.locator('#events .ev')).toHaveCount(2);
  await chip(page, '#evtype', 'Honk').click();
  await expect(page.locator('#events .ev')).toHaveCount(1);
  await tele.click();
  await expect(page.locator('#events .ev')).toHaveCount(1);
});

test('phone drawer: telemetry chip and icon chips fit at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#pickDir').setInputFiles(folder);
  await page.locator('#menuBtn').click();
  await expect(page.locator('#events .ev').first()).toBeVisible();
  const fits = async (sel) => { for (const b of await page.locator(sel).all()) { const r = await b.boundingBox(); if (r) { expect(r.x + r.width).toBeLessThanOrEqual(340); expect(r.height).toBeGreaterThanOrEqual(34); } } };
  await expect(page.locator('#cats .cat-tele')).toBeVisible();
  await fits('#cats button'); await fits('#evtype button');
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
    // turn indicators: own lane, spans with the global time, click seeks to the start
    await expect(page.locator('.ins-sig')).toHaveCount(2);
    await expect(page.locator('.ins-sig.left')).toHaveAttribute('title', 'Left indicator 0:12 to 0:15');
    await expect(page.locator('.ins-sig.right')).toHaveAttribute('title', 'Right indicator 0:21 to 0:23');
    const total = 30; // 3 clips x 10 s
    const lane = await page.locator('.ins-sig').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, w: r.width, h: r.height }; }));
    expect(lane.every((l) => l.h >= 4 && l.w >= 6)).toBe(true);
    const seekBox = await page.locator('#seek').evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x + 8, w: r.width - 16 }; }); // minus half a desktop thumb each side
    expect(Math.abs(lane[0].x - (seekBox.x + seekBox.w * (12 / total)))).toBeLessThan(2);
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

test('loading overlay never sticks: overlapping segment loads all end the task', async ({ page }) => {
  await load(page);
  await open(page, 'Trip');
  // segment loads back to back: each is superseded before its metadata/error event fires
  await page.evaluate(() => {
    const seek = document.getElementById('seek');
    for (const v of [800, 100, 800, 100]) { seek.value = v; seek.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await expect(page.locator('#busy')).toBeHidden({ timeout: 12000 });
  await expect(page.locator('#play')).toBeEnabled();
});

test('an emergency-braking clip always shows its event.json cue at the trigger time', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'tv-aeb-'));
  try {
    await page.locator('#pickDir').setInputFiles(writeAebEvent(dir));
    await expect(page.locator('#events .ev').first()).toBeVisible();
    const cue = page.locator('.ins-tick.trigger');
    await expect(cue).toHaveCount(1);
    await expect(cue).toHaveAttribute('title', `Emergency braking · event trigger · ${Math.floor(AEB_EVENT.triggerS / 60)}:${AEB_EVENT.triggerS % 60}`);
    // 2 clips of 60 s, the cue sits 75/120 of the way along the bar
    expect(parseFloat(await cue.evaluate((e) => e.style.left))).toBeCloseTo((75 / 120) * 100, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a cam that never loads times out, is named, and the overlay still ends', async ({ page }) => {
  // Whether the fixtures' fake H.264 loads or errors depends on the browser build, so force the failure instead of
  // relying on it: the Back tile's src is ignored (metadata never arrives) and the per-cam timeout is shortened.
  await page.addInitScript(() => {
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(HTMLMediaElement.prototype, 'src', { ...d, set(v) { if (this.parentElement?.textContent.trim() === 'Back') return; d.set.call(this, v); } });
  });
  await page.goto('/index.html?loadms=600');
  await load(page);
  await open(page, 'Trip');
  await expect(page.locator('#vidwarn')).toContainText('Back (timeout)');
  await expect(page.locator('#busy')).toBeHidden();
  await expect(page.locator('#play')).toBeEnabled();
});

// ---------- video fills its tile: no crop, no black bars ----------
// Reads every visible tile, its <video>, and the stage; video must equal the tile, sit inside the stage and keep its aspect.
const geometry = (page) => page.evaluate(() => {
  const st = document.getElementById('stage').getBoundingClientRect();
  const tiles = [...document.querySelectorAll('#grid .cam')].filter((d) => getComputedStyle(d).display !== 'none').map((d) => {
    const r = d.getBoundingClientRect(), v = d.querySelector('video').getBoundingClientRect();
    return { cam: d._cam, r: { x: r.x, y: r.y, w: r.width, h: r.height }, v: { x: v.x, y: v.y, w: v.width, h: v.height }, fit: getComputedStyle(d.querySelector('video')).objectFit };
  });
  return { st: { x: st.x, y: st.y, w: st.width, h: st.height }, tiles };
});
const covered = (g) => g.tiles.reduce((s, t) => s + t.v.w * t.v.h, 0) / (g.st.w * g.st.h);
const assertUncropped = (g, ar = 4 / 3) => {
  for (const t of g.tiles) {
    expect(t.fit, `${t.cam} object-fit`).toBe('contain');
    for (const k of ['x', 'y', 'w', 'h']) expect(Math.abs(t.v[k] - t.r[k]), `${t.cam} video ${k} equals tile`).toBeLessThan(1.5);
    expect(Math.abs(t.r.w / t.r.h - ar) / ar, `${t.cam} tile keeps the video aspect`).toBeLessThan(0.01);
    expect(t.r.x).toBeGreaterThanOrEqual(g.st.x - 1); expect(t.r.y).toBeGreaterThanOrEqual(g.st.y - 1);
    expect(t.r.x + t.r.w).toBeLessThanOrEqual(g.st.x + g.st.w + 1); expect(t.r.y + t.r.h).toBeLessThanOrEqual(g.st.y + g.st.h + 1);
  }
};
// what an equal-cell 3x2 grid (the old layout) would cover for 4:3 video
const oldCovered = (g) => { const cw = (g.st.w - 9) / 3, ch = (g.st.h - 6) / 2, s = Math.min(cw / (4 / 3), ch); return (6 * s * s * (4 / 3)) / (g.st.w * g.st.h); };

for (const [W, H] of [[1920, 1080], [1440, 900]]) {
  test(`desktop ${W}x${H}: videos are uncropped, fill their tiles and cover no less than the equal-cell grid`, async ({ page }) => {
    await page.setViewportSize({ width: W, height: H });
    await load(page); await open(page, '2026-03-02_10-00-00');
    await expect(page.locator('#grid .cam')).toHaveCount(6);
    let g = await geometry(page);
    assertUncropped(g); expect(covered(g)).toBeGreaterThanOrEqual(oldCovered(g) - 0.005);
    // focus view: one tile, still uncropped, bigger than any grid tile
    await page.locator('#grid .cam', { hasText: 'Back' }).click();
    const f = await geometry(page);
    expect(f.tiles).toHaveLength(1); assertUncropped(f);
    const back = g.tiles.find((t) => t.cam === 'back');
    expect(f.tiles[0].r.w * f.tiles[0].r.h).toBeGreaterThan(back.r.w * back.r.h * 1.5);
    await page.locator('#grid .cam.main').click();
    // collapsing the sidebar re-fits the tiles to the wider stage
    const before = (await geometry(page)).st.w;
    await page.locator('#sideToggle').click();
    await expect.poll(async () => (await geometry(page)).st.w).toBeGreaterThan(before + 200);
    g = await geometry(page); assertUncropped(g);
    expect(covered(g)).toBeGreaterThan(0.3);
  });
}

test('video with a different real aspect (16:9) is fitted to its own dimensions', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { get: () => 1280 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { get: () => 720 });
  });
  await page.goto('/index.html');
  await page.setViewportSize({ width: 1440, height: 900 });
  await load(page); await open(page, '2026-03-02_10-00-00');
  await page.locator('#grid .cam').first().evaluate((d) => d.querySelector('video').dispatchEvent(new Event('loadedmetadata')));
  assertUncropped(await geometry(page), 16 / 9);
});

test('mixed aspects: each tile uses its own video dimensions', async ({ page }) => {
  await page.addInitScript(() => {
    const wide = (v) => v.closest?.('.cam')?._cam === 'back';
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { get() { return wide(this) ? 1200 : 1280; } });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { get() { return wide(this) ? 1000 : 960; } });
  });
  await page.goto('/index.html');
  await load(page); await open(page, '2026-03-02_10-00-00');
  await page.locator('#grid .cam').first().evaluate((d) => d.querySelector('video').dispatchEvent(new Event('loadedmetadata')));
  const g = await geometry(page);
  for (const t of g.tiles) { const ar = t.cam === 'back' ? 1.2 : 4 / 3; expect(Math.abs(t.r.w / t.r.h - ar) / ar).toBeLessThan(0.01); expect(Math.abs(t.v.w - t.r.w)).toBeLessThan(1.5); }
});

const openOnPhone = async (page) => {
  await page.locator('#pickDir').setInputFiles(folder);
  await page.locator('#menuBtn').click();
  await evt(page, '2026-03-02_10-00-00').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#grid .cam')).toHaveCount(6);
};

test('phone portrait 390x844: main camera fills its area, thumbnails keep aspect, focus and tap-to-swap stay uncropped', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openOnPhone(page);
  await expect(page.locator('#grid .cam')).toHaveCount(6);
  const g = await geometry(page);
  const main = g.tiles.find((t) => t.cam === 'front');
  expect(Math.abs(main.r.w - 390)).toBeLessThan(2);            // full width: no pillarbox
  expect(Math.abs(main.r.w / main.r.h - 4 / 3)).toBeLessThan(0.02);
  for (const t of g.tiles) { expect(t.fit).toBe('contain'); expect(Math.abs(t.r.w / t.r.h - 4 / 3)).toBeLessThan(0.03); expect(Math.abs(t.v.w - t.r.w)).toBeLessThan(2.5); }
  await page.locator('#grid .cam', { hasText: 'Back' }).click();
  const swapped = await geometry(page);
  expect(swapped.tiles.find((t) => t.cam === 'back').r.w).toBeGreaterThan(380);
  await setOpt(page, '#layout', 'focus');
  const f = await geometry(page);
  expect(f.tiles).toHaveLength(1);
  expect(Math.abs(f.tiles[0].r.w - 390)).toBeLessThan(2);
});

test('phone landscape 844x390: main camera is fitted with no side bars', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openOnPhone(page);
  const g = await geometry(page);
  const main = g.tiles.find((t) => t.cam === 'front');
  expect(Math.abs(main.r.w / main.r.h - 4 / 3)).toBeLessThan(0.02);
  expect(Math.abs(main.v.w - main.r.w)).toBeLessThan(1.5);
  expect(main.r.x + main.r.w).toBeLessThanOrEqual(g.st.x + g.st.w + 1);
});

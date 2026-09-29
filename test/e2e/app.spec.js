import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeTeslaCam } from './fixtures.js';

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
  await expect(page.locator('#layout')).toHaveValue('focus');
  await back.click();
  await expect(page.locator('#grid')).not.toHaveClass(/\bfocus\b/);
  await expect(page.locator('#layout')).toHaveValue('auto');
});

test('event-type chips filter the library', async ({ page }) => {
  await load(page);
  await expect(chip(page, '#evtype', 'Saved by you')).toBeVisible();
  await chip(page, '#evtype', 'Sentry trigger').click();
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
  await page.locator('#groupby').selectOption('city');
  await expect(heads).toHaveText(['Madrid', 'Paris', 'Unknown']);   // trip has no event.json city
  await page.locator('#groupby').selectOption('none');
  await expect(heads).toHaveCount(0);
  await expect(page.locator('#events .ev')).toHaveCount(4);
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

test('telemetry HUD follows the playhead and the units switch', async ({ page }) => {
  await load(page);
  await open(page, '2026-03-02_10-00-00');
  await expect(page.locator('#hud')).toBeVisible();
  const speed = () => page.locator('#hud .h-speed b').textContent().then(Number);
  await page.locator('#units').selectOption('kmh');
  await expect(page.locator('#hud .h-speed small')).toHaveText('km/h');
  const kmh = await speed();
  expect(kmh).toBeGreaterThan(0);
  await page.locator('#units').selectOption('mph');
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

<p align="center">
  <img src="icon.svg" alt="Tesla Viewer logo" width="112" height="112">
</p>

<h1 align="center">Tesla Viewer</h1>

<p align="center">
  <b>Synced multi-camera TeslaCam viewer with telemetry. 100% on-device.</b>
</p>

<p align="center">
  <a href="https://github.com/tomassanjuan/tesla-viewer/actions/workflows/test.yml"><img src="https://github.com/tomassanjuan/tesla-viewer/actions/workflows/test.yml/badge.svg" alt="tests"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/backend-none-brightgreen.svg" alt="no backend">
  <img src="https://img.shields.io/badge/uploads-none-brightgreen.svg" alt="no uploads">
  <img src="https://img.shields.io/badge/PWA-offline-5a0fc8.svg" alt="PWA, works offline">
</p>

Free, on-device viewer for TeslaCam / Sentry Mode clips: synced multi-camera playback with telemetry. Static site, no backend, no uploads; your footage never leaves the browser.

Not affiliated with Tesla, Inc. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Features
- Up to 6 synchronized cameras (front, back, both repeaters, both pillars): grid or focus layout, chained 1-minute segments, 0.1x-10x speed, frame step, keyboard shortcuts (Space, `,` `.`, arrows, `?` for help).
- Library sidebar: events from `RecentClips`, `SavedClips`, `SentryClips`; group by month/type/kind/cameras/length, sort, search, `event.json` reasons and `thumb.png`.
- Telemetry from SEI metadata (H.264, plus HEVC support that is only tested with synthetic fixtures): speed (km/h or mph), gear, steering, throttle, brake, blinkers, Autopilot state, G-force, GPS track, speed graph, timeline ticks (hard braking etc.), trip insights, CSV export.
- Trim and export (grid or focused camera, optional HUD) via MediaRecorder: MP4 where the browser supports it, otherwise WebM. Real-time, not faster than playback.
- Manual privacy blur, burned into exports.
- Optional OpenStreetMap map tiles (off by default; when on, tile requests reveal the map area and your IP to OSM). Offline canvas track otherwise.
- Installable PWA, works offline after first load (needs HTTPS or localhost).
- 10 languages (de, en, es, fr, it, ja, nl, pl, pt, zh); translations are not native-reviewed.
- Encrypted clips (firmware 2026.20+), **experimental** and unverified against real clips: local AES decrypt with keys from your own Tesla token or pasted JSON. See [docs/encryption.md](docs/encryption.md).

## Supported formats
- `YYYY-MM-DD_HH-MM-SS-<camera>.mp4`, cameras `front`, `back`, `left_repeater`, `right_repeater`, `left_pillar`, `right_pillar`.
- Telemetry needs firmware 2025.44.25+ on HW3+ (SEI metadata). Older clips play without telemetry.
- macOS `._*` sidecars, `.DS_Store`, `Thumbs.db` and empty clips are ignored.
- Playback relies on your browser's codec support (H.264 everywhere; HEVC depends on browser/OS).

## Quick start
Requires Node 22+ (only for tests) and Python 3 (for the dev server).
```bash
git clone https://github.com/tomassanjuan/tesla-viewer.git
cd tesla-viewer
npm start        # python3 -m http.server 8080
```
Open <http://localhost:8080> and drop your `TeslaCam` folder. Any static server works; there is no build step to run locally.

## Build, test, lint
```bash
npm ci
npm test                          # unit tests (node --test)
npx playwright install chromium   # once
npm run test:e2e                  # browser tests (set CHROMIUM_PATH to use an existing Chromium)
node scripts/version.mjs          # the deploy "build": writes version.json, stamps sw.js cache name
```
There is no linter or bundler; the app is vanilla ES modules. GitHub Actions runs the unit and e2e tests on every PR and push to `main`.

## Deploy
The site is static. Everything except the files listed in `.assetsignore` is served.

### Cloudflare Workers (CLI)
```bash
npx wrangler login
npx wrangler deploy
```
`wrangler.jsonc` sets the `tesla-viewer` Worker name, runs `node scripts/version.mjs` as its build command and serves the repo root as static assets. You get a `https://tesla-viewer.<your-subdomain>.workers.dev` URL; add a custom domain under Worker > Settings > Domains & Routes if you want one. To deploy under another name, change `name` in `wrangler.jsonc`.

### Cloudflare dashboard (Git CI)
Workers & Pages > Create > Import a repository, pick your fork, build command empty (the `build` in `wrangler.jsonc` is used), deploy command `npx wrangler deploy`. Note this connects Cloudflare to your GitHub repo and adds deployment status links to commits that include your Cloudflare account ID; use the CLI if you want to avoid that.

### Other static hosts
Netlify, Vercel, GitHub Pages, S3, nginx, etc.: publish the repo root (no build needed). Optional: run `node scripts/version.mjs` first with `GITHUB_SHA` or `WORKERS_CI_COMMIT_SHA` set to stamp the version chip and cache name (otherwise it shows `dev`).

### Notes
- Sub-path hosting (e.g. `https://user.github.io/tesla-viewer/`) works: the service worker, manifest and `version.json` use relative URLs.
- The service worker and PWA install require HTTPS (or localhost).
- `scripts/version.mjs` rewrites `VERSION` in `sw.js` in place when a commit SHA is in the environment; don't commit that change.
- Per-branch previews: `wrangler.jsonc` has a `previews` block, so `npx wrangler preview` works.

## Contributing
See [ROADMAP.md](ROADMAP.md) for status and open items. Issues and PRs welcome.

## License
[MIT](LICENSE) © 2026 Tomas Sanjuan. Third-party credits, map data and trademark notes: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

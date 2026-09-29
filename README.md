# Tesla Viewer

Free, on-device clone of tesclip.com: view TeslaCam / Sentry clips in synced multiview with telemetry. Static site, no backend, nothing leaves your browser.

**Run:** `npm start` (or any static server) and open http://localhost:8080. Drop your `TeslaCam` folder.

## Features
- Up to 6 synchronized cameras, grid or focus layout, chained 1-minute segments, 0.1x-10x speed, frame step, keyboard shortcuts (Space, `,` `.`, arrows).
- Telemetry from H.264 SEI (fw 2025.44.25+, HW3+): speed (km/h or mph), gear, steering, throttle, brake, blinkers, autopilot state, G-force, GPS track, speed graph, CSV export.
- Encrypted clips (fw 2026.20+), **experimental**: local AES decrypt; keys via your Tesla token or pasted JSON. See [ROADMAP.md](ROADMAP.md) for caveats.

## Development
`npm test` runs the unit tests (MP4/SEI parsing, MD5, grouping, decrypt round-trip). Vanilla ES modules, no build.

See [ROADMAP.md](ROADMAP.md) for status and next steps. Format credits: [teslamotors/dashcam](https://github.com/teslamotors/dashcam), [XGxF3/tesla-dashcam-decrypt](https://github.com/XGxF3/tesla-dashcam-decrypt).

## Deploys and previews
Cloudflare Workers Builds deploys `main` with `npx wrangler deploy` (config in `wrangler.jsonc`, no build step). For per-branch previews, enable non-production branch builds in the Cloudflare dashboard (Worker > Settings > Builds) and set the non-production deploy command to `npx wrangler versions upload`, so branches never overwrite production.

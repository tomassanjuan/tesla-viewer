# Roadmap

Goal: a free, fully on-device alternative to tesclip.com. Static site, no backend, no uploads, no build step.

## Format facts (basis for the design)
- Clips are `YYYY-MM-DD_HH-MM-SS-<camera>.mp4`, ~1 min each, one file per camera
  (`front, back, left_repeater, right_repeater, left_pillar, right_pillar`).
  Folders: `RecentClips`, `SavedClips/<event>`, `SentryClips/<event>` (+ `event.json`, `thumb.png`).
- Telemetry (fw 2025.44.25+, HW3+) is a protobuf in H.264 SEI NAL units (type 6, payload type 5,
  `0x42…0x42 0x69` marker), one per frame. Schema: [teslamotors/dashcam](https://github.com/teslamotors/dashcam).
- fw 2026.20+ encrypts clips (eCryptfs-style container: AES-128-CBC, 4096-byte pages, per-page
  IV = MD5(MD5(key) + ascii(page) zero-padded to 32 B), payload at 0x2000). The per-file key is
  wrapped and must be fetched from Tesla's servers with the owner's account token.

## Phases
- [x] **P0 Core**: MP4 box parser, SEI extraction, minimal protobuf decoder (no deps), CSV export.
- [x] **P1 Library**: drop a folder / files, group by timestamp into events and segments, chain segments into one timeline.
- [x] **P2 Multiview**: up to 6 synchronized cameras, one master clock, layout presets, focus mode, seek/speed (0.1x-10x), frame step.
- [x] **P3 Telemetry**: HUD (speed, gear, pedals, steering, blinkers, autopilot), G-force, GPS track canvas, unit toggle, timeline graph.
- [x] **P4 Encryption (experimental)**: detect encrypted containers, parse header, on-device AES decrypt (WebCrypto + JS MD5),
      keys via user-provided Tesla token or pasted key JSON. Header layout and IV scheme come from third-party reverse
      engineering and are unverified against real clips here.
- [x] **P5 Export**: set in/out, export grid or focused cam with optional HUD via canvas.captureStream + MediaRecorder (mp4 if supported, else webm; real-time, js/export.js). WebCodecs faster-than-realtime muxing is a possible upgrade.
- [x] **P6 Map tiles** (opt-in, off by default to stay fully offline), reverse-geocode-free location display.
- [~] **P7 Polish**: done: PWA/offline install (manifest, sw.js cache-first, icon), HEVC clips detected + non-crashing status (SEI decode still open, dashcam#14), `?` shortcut help, aria-labels. Open: HEVC SEI decode, i18n, license-plate blur.
- [ ] **P8 Verify encryption** against real clips; CORS-free key flow (browser extension or paste flow) if Tesla blocks cross-origin.

## Non-goals
Uploading video anywhere, accounts, ads, watermarks.

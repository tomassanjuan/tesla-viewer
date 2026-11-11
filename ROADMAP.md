# Roadmap

Goal: a free, fully on-device viewer for TeslaCam clips. Static site, no backend, no uploads, no build step.

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
- [x] **P7 Polish**: PWA/offline install (manifest, cache-first sw.js), `?` shortcut help, aria-labels; HEVC clips (hvcC length size, prefix/suffix SEI in js/hevc.js, tolerant protobuf + `fieldsSeen` diagnostics; synthetic-fixture tested only, dashcam#14); i18n (10 locales, runtime DOM translation, js/i18n.js; translations not native-reviewed); manual privacy blur (js/blur.js, burned into exports; no automatic plate detector shipped).
- [~] **P8 Encryption hardening**: strict header validation, wrong-key detection, streaming decrypt with progress/abort, key-JSON shapes, retrying key fetch with clear CORS/401 messages (js/tesla-crypto.js, js/decrypt-ui.js, docs/encryption.md). Still unverified against real encrypted clips; header id/size overlap is the top risk.
- [x] **P9 Insights**: `event.json` (reason, place) and `thumb.png` shown on event cards; js/insights.js computes trip summary
      (GPS distance with jitter filter, duration, max/avg speed, autopilot %, hard braking/accel, sharp turns, AP engage/disengage)
      in a units-aware panel, plus clickable timeline ticks that seek. Thresholds are heuristics (`DEFAULTS`), not calibrated.
- [x] **P10 UI redesign**: design tokens, dark/light theme, dashboard HUD, icon dock, empty-state drop zone, responsive layout (style.css, js/ui.js).

## Open
- Verify everything on real TeslaCam clips (playback sync, export, HEVC SEI, encryption).
- Faster-than-realtime export via WebCodecs + muxer; export audio.
- Automatic plate detection would need an ML model shipped on-device.

## Non-goals
Uploading video anywhere, accounts, ads, watermarks.

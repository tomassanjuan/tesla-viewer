// Synthetic TeslaCam clips for the browser tests: minimal H.264-shaped MP4s (ftyp + moov + mdat) carrying Tesla SEI telemetry.
// Not decodable video: the app must cope (parsing/telemetry/layout do not need decoded frames).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const varint = (n) => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return o; };
const f32 = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return [...b]; };
const f64 = (v) => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return [...b]; };
const u32 = (...v) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeUInt32BE(x, i * 4)); return b; };
const box = (type, ...kids) => {
  const body = Buffer.concat(kids.map((k) => Buffer.from(k)));
  const h = Buffer.alloc(8); h.writeUInt32BE(body.length + 8); h.write(type, 4);
  return Buffer.concat([h, body]);
};

function seiNal({ speed, lat, lon, seq, accel = 0.3, ax = 0, ay = 0 }) {
  const payload = [0x08, 2, 0x10, 1, 0x18, ...varint(seq), 0x25, ...f32(speed), 0x2d, ...f32(accel), 0x35, ...f32(seq % 20), 0x59, ...f64(lat), 0x61, ...f64(lon), 0x71, ...f64(ax), 0x79, ...f64(ay)];
  const esc = []; let z = 0;
  for (const b of payload) { if (z >= 2 && b <= 3) { esc.push(3); z = 0; } esc.push(b); z = b === 0 ? z + 1 : 0; }
  return Uint8Array.from([0x06, 0x05, 0xff, 0x42, 0x42, 0x69, ...esc, 0x80]);
}

/**
 * opts: sei (default true), frames (30), fps (30), speed0 (m/s at first frame, ramps +0.5/frame), lat/lon,
 *       ay(frame) (lateral m/s2, default 0), moovPad (bytes of junk inside moov, to force a big moov before mdat),
 *       seiFrom (first frame that carries SEI), idrPad (bytes of slice data in the first frame: a real IDR is 100+ KB).
 */
export function makeClip({ sei = true, frames = 30, fps = 30, speed0 = 5, lat = 40.4, lon = -3.7, moovPad = 0, ay = () => 0, seiFrom = 0, idrPad = 0 } = {}) {
  const nals = [];
  for (let i = 0; i < frames; i++) {
    if (sei && i >= seiFrom) nals.push(seiNal({ speed: speed0 + i * 0.5, lat: lat + i * 1e-5, lon: lon + i * 1e-5, seq: i, ay: ay(i) }));
    nals.push(i === 0 ? [0x65, 1, 2, 3, ...new Uint8Array(idrPad)] : [0x41, 9, 9]);
  }
  const mdatBody = Buffer.concat(nals.map((n) => Buffer.concat([u32(n.length), Buffer.from(n)])));
  const entry = Buffer.alloc(8 + 78); entry.write('avc1', 4); entry.writeUInt32BE(entry.length, 0);
  entry.writeUInt16BE(1280, 8 + 24); entry.writeUInt16BE(960, 8 + 26);
  const stsd = box('stsd', u32(0, 1), entry);
  const stts = box('stts', u32(0, 1, frames, 1000));
  const mdhd = box('mdhd', u32(0, 0, 0, fps * 1000, 0), Buffer.alloc(4));
  const kids = [box('trak', box('mdia', mdhd, box('minf', box('stbl', stsd, stts))))];
  if (moovPad) kids.unshift(box('udta', Buffer.alloc(moovPad, 0x61)));
  return Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('moov', ...kids), box('mdat', mdatBody)]);
}

export const CAMS6 = ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar'];
const minute = (base, i) => { const [d, t] = base.split('_'); const [h, m, s] = t.split('-').map(Number); return `${d}_${String(h).padStart(2, '0')}-${String(m + i).padStart(2, '0')}-${String(s).padStart(2, '0')}`; };

/**
 * Writes a TeslaCam-shaped folder under `root` and returns the folder to give to the file picker.
 * - RecentClips: 2-minute trip, 6 cameras, SEI on front only (like real footage).
 * - SavedClips/<saved>: 6 cameras, SEI, event.json (user_interaction, Madrid).
 * - SentryClips/<sentry>: 4 cameras, no SEI, event.json (sentry, Paris).
 * - SavedClips/<bigmoov>: front only, SEI, 3 MB moov ahead of mdat, event.json honk.
 */
export function writeTeslaCam(root) {
  const cam = join(root, 'TeslaCam');
  const put = (rel, data) => { const p = join(cam, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); };
  const ev = (reason, city) => JSON.stringify({ timestamp: '2026-03-02T10:00:00', city, street: 'Calle Mayor', est_lat: '40.41', est_lon: '-3.70', reason, camera: '0' });

  for (let i = 0; i < 2; i++) {
    const ts = minute('2026-03-01_08-00-00', i);
    for (const c of CAMS6) put(`RecentClips/${ts}-${c}.mp4`, makeClip({ sei: c === 'front', speed0: 8 + i * 15 }));
  }
  const saved = '2026-03-02_10-00-00';
  for (let i = 0; i < 2; i++) for (const c of CAMS6) put(`SavedClips/${saved}/${minute(saved, i)}-${c}.mp4`, makeClip({ speed0: 3 + i * 15 }));
  put(`SavedClips/${saved}/event.json`, ev('user_interaction_dashcam_icon_tap', 'Madrid'));

  const sentry = '2026-03-03_22-00-00';
  for (const c of ['front', 'back', 'left_repeater', 'right_repeater']) put(`SentryClips/${sentry}/${sentry}-${c}.mp4`, makeClip({ sei: false }));
  put(`SentryClips/${sentry}/event.json`, ev('sentry_aware_object_detection', 'Paris'));

  const big = '2026-03-04_09-00-00';
  put(`SavedClips/${big}/${big}-front.mp4`, makeClip({ moovPad: 3 * 1024 * 1024 }));
  put(`SavedClips/${big}/event.json`, ev('user_interaction_honk', 'Madrid'));
  return cam;
}

/** Telemetry-probe edge cases (separate folder so the library counts in other tests stay put):
 * <late>: first frame has no SEI and a 300 KB IDR, SEI starts on frame 1; <backonly>: SEI on the back cam only. */
export function writeTelemetryEdges(root) {
  const cam = join(root, 'TeslaCam');
  const put = (rel, data) => { const p = join(cam, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); };
  const ev = JSON.stringify({ city: 'Madrid', reason: 'user_interaction_honk' });
  const late = '2026-03-05_09-00-00', backOnly = '2026-03-06_09-00-00';
  put(`SavedClips/${late}/${late}-front.mp4`, makeClip({ seiFrom: 1, idrPad: 300000 }));
  put(`SavedClips/${late}/event.json`, ev);
  put(`SavedClips/${backOnly}/${backOnly}-front.mp4`, makeClip({ sei: false }));
  put(`SavedClips/${backOnly}/${backOnly}-back.mp4`, makeClip());
  put(`SavedClips/${backOnly}/event.json`, ev);
  return cam;
}

/** A 3-clip trip (10 s each, front SEI) with one sharp-turn spike per clip, at known frames: peak times 5 s, 12 s, 28 s (global). */
export const TURN_TRIP = { name: '2026-04-01_09-00-00', spikes: [5, 12, 28] };
export function writeTurnTrip(root) {
  const cam = join(root, 'TeslaCam');
  for (let i = 0; i < 3; i++) {
    const at = TURN_TRIP.spikes.map((t) => (t - i * 10) * 30).find((f) => f >= 0 && f < 300);
    const ts = minute(TURN_TRIP.name, i);
    const p = join(cam, `RecentClips/${ts}-front.mp4`); mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, makeClip({ frames: 300, ay: (f) => (at !== undefined && f >= at && f < at + 10 ? 6 : 0) }));
  }
  return cam;
}

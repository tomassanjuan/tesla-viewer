import { decodeWire } from './protobuf.js';

export const GEAR = ['P', 'D', 'R', 'N'];
export const AUTOPILOT = ['Off', 'Self-driving', 'Autosteer', 'TACC'];

// Field numbers/types from teslamotors/dashcam dashcam.proto. 'f'=float32, 'd'=double, 'v'=varint.
const SCHEMA = {
  1: ['version', 'v'], 2: ['gear', 'v'], 3: ['frameSeq', 'v'], 4: ['speedMps', 'f'],
  5: ['accel', 'f'], 6: ['steering', 'f'], 7: ['blinkerLeft', 'v'], 8: ['blinkerRight', 'v'],
  9: ['brake', 'v'], 10: ['autopilot', 'v'], 11: ['lat', 'd'], 12: ['lon', 'd'],
  13: ['heading', 'd'], 14: ['ax', 'd'], 15: ['ay', 'd'], 16: ['az', 'd'],
};

/** Decode one SEI NAL unit (starting at the NAL header byte) into a telemetry object, or null. */
export function decodeSei(nal) {
  if (nal.length < 4) return null;
  let i = 3;
  while (i < nal.length && nal[i] === 0x42) i++;
  if (i <= 3 || i + 1 >= nal.length || nal[i] !== 0x69) return null;
  try {
    const raw = decodeWire(stripEmulation(nal.subarray(i + 1, nal.length - 1)));
    const m = {};
    for (const [n, [name]] of Object.entries(SCHEMA)) m[name] = raw[n] ?? 0;
    for (const k of ['blinkerLeft', 'blinkerRight', 'brake']) m[k] = !!m[k];
    m.accel = Math.min(1, Math.max(0, m.accel / 100)); // Tesla reports 0-100; expose 0..1
    return m;
  } catch { return null; }
}

export function stripEmulation(data) {
  const out = new Uint8Array(data.length);
  let n = 0, zeros = 0;
  for (const b of data) {
    if (zeros >= 2 && b === 3) { zeros = 0; continue; }
    out[n++] = b;
    zeros = b === 0 ? zeros + 1 : 0;
  }
  return out.subarray(0, n);
}

export function csv(samples) {
  const cols = ['t', ...Object.values(SCHEMA).map((s) => s[0])];
  const rows = samples.map((s) => cols.map((c) => (s[c] ?? '')).join(','));
  return [cols.join(','), ...rows].join('\n');
}

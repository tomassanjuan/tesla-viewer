// Tesla fw 2026.20+ encrypted clip support. EXPERIMENTAL: layout/IV scheme is from third-party
// reverse engineering (XGxF3/tesla-dashcam-decrypt) and has not been verified against real clips here.
import { md5 } from './md5.js';

const PAGE = 4096, HDR2 = 0x1000, PAYLOAD = 0x2000;
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');

/** True when the first 8 KiB look like a Tesla encrypted container (not a plain MP4). */
export function isEncrypted(u8) {
  if (u8.length < PAYLOAD || String.fromCharCode(u8[4], u8[5], u8[6], u8[7]) === 'ftyp') return false;
  const dv = new DataView(u8.buffer, u8.byteOffset);
  return dv.getUint32(0x14) === PAGE && dv.getUint32(HDR2) !== 0 && u8[HDR2 + 4] === 0x04;
}

export function parseHeader(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset);
  const id = u8.subarray(4, 20);
  const uuid = `${hex(id.subarray(0, 4))}-${hex(id.subarray(4, 6))}-${hex(id.subarray(6, 8))}-${hex(id.subarray(8, 10))}-${hex(id.subarray(10))}`;
  return {
    plainSize: Number(dv.getBigUint64(0)),
    id: uuid,
    key_id: dv.getUint32(HDR2),
    public_key: b64(u8.subarray(HDR2 + 4, HDR2 + 69)),
    vin: String.fromCharCode(...u8.subarray(HDR2 + 69, HDR2 + 86)),
    timestamp: Number(dv.getBigUint64(HDR2 + 86)),
    wrapped_key: b64(u8.subarray(HDR2 + 94, HDR2 + 138)),
  };
}

/** Per-page IV = MD5( MD5(key) || ascii(page) zero-padded to 32 bytes ). */
export function pageIv(rootIv, page) {
  const m = new Uint8Array(32);
  m.set(rootIv); m.set(new TextEncoder().encode(String(page)), 16);
  return md5(m);
}

/** Decrypt a full encrypted container to plaintext MP4 bytes. key: 16-byte Uint8Array. */
export async function decrypt(u8, key, subtle = globalThis.crypto.subtle) {
  const { plainSize } = parseHeader(u8);
  const k = await subtle.importKey('raw', key, 'AES-CBC', false, ['decrypt', 'encrypt']);
  const rootIv = md5(key);
  const out = new Uint8Array(plainSize);
  const pages = Math.ceil(plainSize / PAGE);
  for (let p = 0; p < pages; p++) {
    const ct = u8.subarray(PAYLOAD + p * PAGE, PAYLOAD + (p + 1) * PAGE);
    if (ct.length !== PAGE) throw new Error('Truncated encrypted page ' + p);
    const iv = pageIv(rootIv, p);
    // WebCrypto AES-CBC insists on PKCS7; append a block that decrypts to valid padding.
    const padEnc = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv: ct.subarray(PAGE - 16) }, k, new Uint8Array(0)));
    const buf = new Uint8Array(PAGE + 16);
    buf.set(ct); buf.set(padEnc.subarray(0, 16), PAGE);
    const pt = new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv }, k, buf));
    out.set(pt.subarray(0, Math.min(PAGE, plainSize - p * PAGE)), p * PAGE);
  }
  return out;
}

/** Fetch per-file keys from Tesla with the owner's bearer token. May be blocked by CORS in browsers. */
export async function fetchKeys(headers, token) {
  const items = headers.map(({ id, vin, key_id, timestamp, wrapped_key, public_key }) => ({ id, vin, key_id, timestamp, wrapped_key, public_key }));
  const r = await fetch('https://dashcam.tesla.com/api/1/decrypt/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!r.ok) throw new Error(`Tesla key API returned ${r.status}`);
  const keys = {};
  for (const res of (await r.json()).results ?? []) if (!res.error) keys[res.id] = unb64(res.key);
  return keys;
}

/** Parse a user-pasted JSON map { "<uuid>": "<base64 key>" }. */
export function parseKeyJson(text) {
  const keys = {};
  for (const [id, v] of Object.entries(JSON.parse(text))) keys[id] = unb64(v);
  return keys;
}

// Tesla fw 2026.20+ encrypted clip support. EXPERIMENTAL: layout/IV scheme is from third-party
// reverse engineering (XGxF3/tesla-dashcam-decrypt) and has NOT been verified against real clips here.
// See docs/encryption.md.
import { md5 } from './md5.js';

export const PAGE = 4096, HDR2 = 0x1000, PAYLOAD = 0x2000;
const HDR_END = HDR2 + 138;                    // key_id(4) pub(65) vin(17) ts(8) wrapped(44)
const ECRYPTFS_MARKER = 0x3c81b7f5;            // eCryptfs MAGIC_ECRYPTFS_MARKER (magic1 ^ magic2); soft check only

export class CryptoError extends Error { constructor(code, msg) { super(msg); this.name = code; this.code = code; } }
export class NotEncrypted extends CryptoError { constructor(m = 'Not a Tesla encrypted clip') { super('NotEncrypted', m); } }
export class UnsupportedVersion extends CryptoError { constructor(m) { super('UnsupportedVersion', m); } }
export class TruncatedFile extends CryptoError { constructor(m) { super('TruncatedFile', m); } }
export class BadKey extends CryptoError { constructor(m = 'Decryption produced no MP4 (wrong key for this file?)') { super('BadKey', m); } }
/** kind: expired | forbidden | network | http */
export class KeyFetchError extends CryptoError { constructor(kind, msg) { super('KeyFetchError', msg); this.kind = kind; } }

const b64 = (u8) => btoa(String.fromCharCode(...u8));
export const unb64 = (s) => Uint8Array.from(atob(String(s).trim().replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
const tag = (u8, o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);

/**
 * Parse the two header pages. u8 needs the first 0x2000 bytes; fileSize (default u8.length) enables the
 * size-vs-payload sanity check. Throws NotEncrypted / TruncatedFile / UnsupportedVersion.
 *
 * Layout (per WRITEUP.md): 0x00 plaintext size u64 BE; 0x08/0x0c magic words; 0x10 version/flags;
 * 0x14 page size. The write-up ALSO lists the 16 "file id" bytes at 0x04..0x14, which overlaps size
 * (0x04..0x08), magic and version. The reference script really reads both, so we mirror it:
 * `id` = bytes 4..20 (what the reference sends as API item id), `plainSize` = bytes 0..8. Unverified.
 */
export function parseHeader(u8, fileSize = u8.length) {
  if (u8.length >= 8 && tag(u8, 4) === 'ftyp') throw new NotEncrypted('Plain MP4 (ftyp box), not encrypted');
  if (u8.length < HDR_END) throw new TruncatedFile('File shorter than the 8 KiB Tesla header');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0x14) !== PAGE) throw new NotEncrypted('No 4096-byte page size at 0x14; not a Tesla container');
  if (dv.getUint32(HDR2) === 0) throw new NotEncrypted('Empty key_id');
  if (u8[HDR2 + 4] !== 0x04) throw new UnsupportedVersion('Public key is not an uncompressed EC point (0x04)');
  const vin = String.fromCharCode(...u8.subarray(HDR2 + 69, HDR2 + 86));
  if (!/^[A-Z0-9]{17}$/.test(vin)) throw new UnsupportedVersion('VIN field is not 17 alphanumeric characters');
  const plainSize = Number(dv.getBigUint64(0));
  if (!(plainSize > 0) || !Number.isSafeInteger(plainSize)) throw new UnsupportedVersion('Invalid plaintext size in header');
  const pages = Math.ceil(plainSize / PAGE);
  if (fileSize < PAYLOAD + pages * PAGE) throw new TruncatedFile(`File is ${fileSize} bytes, header implies ${PAYLOAD + pages * PAGE}`);
  const id = u8.subarray(4, 20);
  return {
    plainSize, pages,
    id: `${hex(id.subarray(0, 4))}-${hex(id.subarray(4, 6))}-${hex(id.subarray(6, 8))}-${hex(id.subarray(8, 10))}-${hex(id.subarray(10))}`,
    magicOk: ((dv.getUint32(8) ^ dv.getUint32(12)) >>> 0) === ECRYPTFS_MARKER, // informational, never fatal
    key_id: dv.getUint32(HDR2),
    public_key: b64(u8.subarray(HDR2 + 4, HDR2 + 69)),
    vin,
    timestamp: Number(dv.getBigUint64(HDR2 + 86)),
    wrapped_key: b64(u8.subarray(HDR2 + 94, HDR2 + 138)),
  };
}

/** True when the head bytes parse as a Tesla encrypted container. Pass the file size when known. */
export function isEncrypted(u8, fileSize) {
  try { parseHeader(u8, fileSize ?? Infinity); return true; } catch { return false; }
}

/** Per-page IV = MD5( MD5(key) || ascii(page) zero-padded to 32 bytes ). */
export function pageIv(rootIv, page) {
  const m = new Uint8Array(32);
  m.set(rootIv); m.set(new TextEncoder().encode(String(page)), 16);
  return md5(m);
}

const isMp4 = (u8) => u8.length >= 8 && ['ftyp', 'moov', 'mdat'].includes(tag(u8, 4));
const abortErr = () => new DOMException('Aborted', 'AbortError');
const yieldLoop = () => new Promise((r) => setTimeout(r));
const EMPTY = new Uint8Array(0);

/**
 * Decrypt consecutive pages (starting at page `p0`) with ONE WebCrypto decrypt call.
 * Trick: CBC decrypts block0 of page i as D(c0)^lastCt(i-1) instead of D(c0)^iv_i, so we XOR the
 * first 16 bytes of every page (i>0) with lastCt(i-1)^iv_i. One extra encrypt makes valid PKCS7 padding.
 */
async function decryptPages(subtle, k, rootIv, ct, p0) {
  const n = ct.length / PAGE;
  const padEnc = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv: ct.subarray(ct.length - 16) }, k, EMPTY));
  const buf = new Uint8Array(ct.length + 16);
  buf.set(ct); buf.set(padEnc.subarray(0, 16), ct.length);
  const pt = new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv: pageIv(rootIv, p0) }, k, buf));
  for (let i = 1; i < n; i++) {
    const iv = pageIv(rootIv, p0 + i), prev = ct.subarray(i * PAGE - 16, i * PAGE);
    for (let j = 0; j < 16; j++) pt[i * PAGE + j] ^= prev[j] ^ iv[j];
  }
  return pt.subarray(0, ct.length);
}

/**
 * Decrypt a File/Blob to a Blob in bounded-memory batches. key: 16-byte Uint8Array.
 * opts: onProgress(fraction), signal, batchPages (default 256 = 1 MiB), subtle.
 * Throws BadKey as soon as the first page does not look like MP4 (ftyp/moov/mdat).
 */
export async function decryptToBlob(blob, key, { onProgress, signal, batchPages = 256, subtle = globalThis.crypto.subtle } = {}) {
  const head = new Uint8Array(await blob.slice(0, PAYLOAD).arrayBuffer());
  const { plainSize, pages } = parseHeader(head, blob.size);
  const k = await subtle.importKey('raw', key, 'AES-CBC', false, ['decrypt', 'encrypt']);
  const rootIv = md5(key);
  const parts = [];
  for (let p = 0; p < pages; p += batchPages) {
    if (signal?.aborted) throw abortErr();
    const n = Math.min(batchPages, pages - p);
    const ct = new Uint8Array(await blob.slice(PAYLOAD + p * PAGE, PAYLOAD + (p + n) * PAGE).arrayBuffer());
    if (ct.length !== n * PAGE) throw new TruncatedFile('Truncated encrypted page near ' + p);
    let pt = await decryptPages(subtle, k, rootIv, ct, p);
    if (p === 0 && !isMp4(pt)) throw new BadKey();
    if ((p + n) * PAGE > plainSize) pt = pt.subarray(0, plainSize - p * PAGE);
    parts.push(pt.slice());              // copy: don't retain the big batch buffer
    onProgress?.((p + n) / pages);
    await yieldLoop();
  }
  return new Blob(parts, { type: 'video/mp4' });
}

/** Back-compat: decrypt a full container held in memory to plaintext bytes. */
export async function decrypt(u8, key, subtle = globalThis.crypto.subtle) {
  return new Uint8Array(await (await decryptToBlob(new Blob([u8]), key, { subtle })).arrayBuffer());
}

/** Normalise key JSON (text or parsed) to { id: Uint8Array(16) }. Shapes: {id:b64}, [{id,key}], {results:[{id,key}]}. */
export function parseKeyJson(input) {
  let data = typeof input === 'string' ? JSON.parse(input) : input;
  if (data && !Array.isArray(data) && Array.isArray(data.results)) data = data.results;
  const pairs = Array.isArray(data) ? data.filter((r) => r && !r.error).map((r) => [r.id, r.key]) : Object.entries(data ?? {});
  const keys = {};
  for (const [id, v] of pairs) {
    if (!id || typeof v !== 'string') throw new Error(`Bad key entry for "${id}"`);
    const k = unb64(v);
    if (k.length !== 16) throw new Error(`Key for ${id} is ${k.length} bytes, expected 16`);
    keys[id] = k;
  }
  if (!Object.keys(keys).length) throw new Error('No keys found in JSON');
  return keys;
}

/** Serialise keys as { id: base64 } JSON for reuse with parseKeyJson. */
export const exportKeysJson = (keys) => JSON.stringify(Object.fromEntries(Object.entries(keys).map(([id, k]) => [id, b64(k)])), null, 2);

const HELP = ' Fetch keys another way (e.g. dashcam.tesla.com DevTools) and paste them as JSON.';
/**
 * Fetch per-file keys from Tesla in chunks of 20 with retry/backoff. The token is only used for the request
 * and is never stored. Returns { keys, errors } (errors: id -> message). May be blocked by CORS in browsers.
 */
export async function fetchKeys(headers, token, { fetchImpl = globalThis.fetch, chunk = 20, retries = 3, backoff = 500, signal, onProgress, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const keys = {}, errors = {};
  for (let i = 0; i < headers.length; i += chunk) {
    const items = headers.slice(i, i + chunk).map(({ id, vin, key_id, timestamp, wrapped_key, public_key }) => ({ id, vin, key_id, timestamp, wrapped_key, public_key }));
    let json;
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortErr();
      let r;
      try {
        r = await fetchImpl('https://dashcam.tesla.com/api/1/decrypt/batch', {
          method: 'POST', signal,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        });
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        if (attempt < retries) { await sleep(backoff * 2 ** attempt); continue; }
        throw new KeyFetchError('network', 'Could not reach Tesla (network error or blocked by CORS).' + HELP);
      }
      if (r.ok) { json = await r.json(); break; }
      if (r.status === 401) throw new KeyFetchError('expired', 'Token expired or invalid (401). Get a fresh token.' + HELP);
      if (r.status === 403) throw new KeyFetchError('forbidden', 'Access denied (403): this account does not own these clips.' + HELP);
      if ((r.status === 429 || r.status >= 500) && attempt < retries) { await sleep(backoff * 2 ** attempt); continue; }
      throw new KeyFetchError('http', `Tesla key API returned ${r.status}.` + HELP);
    }
    for (const res of json.results ?? []) {
      if (res.error) errors[res.id] = String(res.error);
      else try { Object.assign(keys, parseKeyJson({ [res.id]: res.key })); } catch (e) { errors[res.id] = e.message; }
    }
    onProgress?.(Math.min(i + chunk, headers.length) / headers.length);
  }
  return { keys, errors };
}

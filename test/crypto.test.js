import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createCipheriv, randomBytes, webcrypto } from 'node:crypto';
import { isEncrypted, parseHeader, decrypt, decryptToBlob, pageIv, fetchKeys, parseKeyJson, exportKeysJson, BadKey, TruncatedFile, NotEncrypted, UnsupportedVersion, KeyFetchError } from '../js/tesla-crypto.js';

const subtle = webcrypto.subtle;
const KEY = Buffer.from('0123456789abcdef');
const ID = '00112233-4455-6677-8899-aabbccddeeff';

// Plaintext with an ftyp box first, random filler after; arbitrary length.
const mkPlain = (len) => { const b = randomBytes(len); b.writeUInt32BE(len, 0); b.write('ftyp', 4); return b; };

function mkContainer(plain, key = KEY) {
  const pages = Math.ceil(plain.length / 4096);
  const file = Buffer.alloc(0x2000 + pages * 4096);
  Buffer.from(ID.replaceAll('-', ''), 'hex').copy(file, 4);
  file.writeBigUInt64BE(BigInt(plain.length), 0); file.writeUInt32BE(4096, 0x14);
  file.writeUInt32BE(1, 0x1000); file[0x1004] = 4; file.write('5YJ3E1EA7KF000000', 0x1045);
  const root = createHash('md5').update(key).digest();
  for (let p = 0; p < pages; p++) {
    const blk = Buffer.alloc(4096); plain.copy(blk, 0, p * 4096, (p + 1) * 4096);
    const iv = createHash('md5').update(Buffer.concat([root, Buffer.from(String(p)), Buffer.alloc(32 - 16 - String(p).length)])).digest();
    assert.deepEqual(Buffer.from(pageIv(root, p)), iv);
    const c = createCipheriv('aes-128-cbc', key, iv).setAutoPadding(false);
    Buffer.concat([c.update(blk), c.final()]).copy(file, 0x2000 + p * 4096);
  }
  return file;
}

test('round trip: single page, multi page, non page-aligned, batch boundaries', async () => {
  for (const len of [100, 4096, 4097, 3 * 4096 + 17, 10 * 4096]) {
    const plain = mkPlain(len), file = mkContainer(plain);
    const u8 = new Uint8Array(file);
    assert.ok(isEncrypted(u8), 'len ' + len);
    assert.deepEqual(Buffer.from(await decrypt(u8, new Uint8Array(KEY), subtle)), plain, 'len ' + len);
    const seen = [];
    const blob = await decryptToBlob(new Blob([file]), new Uint8Array(KEY), { subtle, batchPages: 3, onProgress: (f) => seen.push(f) });
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), plain, 'batched ' + len);
    assert.equal(seen.at(-1), 1);
  }
});

test('header parsing', () => {
  const h = parseHeader(new Uint8Array(mkContainer(mkPlain(5000))));
  assert.equal(h.plainSize, 5000); assert.equal(h.pages, 2); assert.equal(h.vin, '5YJ3E1EA7KF000000'); assert.equal(h.key_id, 1);
  assert.equal(h.id.length, 36);
});

test('typed errors: not encrypted, unsupported, truncated', () => {
  const f = mkContainer(mkPlain(9000));
  assert.throws(() => parseHeader(new Uint8Array(mkPlain(9000))), NotEncrypted);
  assert.throws(() => parseHeader(new Uint8Array(f.subarray(0, 100))), TruncatedFile);
  assert.throws(() => parseHeader(new Uint8Array(f.subarray(0, 0x2000 + 4096)), 0x2000 + 4096), TruncatedFile); // header says 3 pages
  const badPage = Buffer.from(f); badPage.writeUInt32BE(8192, 0x14);
  assert.throws(() => parseHeader(new Uint8Array(badPage)), NotEncrypted);
  const badVin = Buffer.from(f); badVin.write('!!!', 0x1045);
  assert.throws(() => parseHeader(new Uint8Array(badVin)), UnsupportedVersion);
  const badKey = Buffer.from(f); badKey[0x1004] = 2;
  assert.throws(() => parseHeader(new Uint8Array(badKey)), UnsupportedVersion);
  assert.equal(isEncrypted(new Uint8Array(badVin)), false);
});

test('truncated payload rejects before decrypting', async () => {
  const f = mkContainer(mkPlain(9000));
  await assert.rejects(decryptToBlob(new Blob([f.subarray(0, f.length - 10)]), new Uint8Array(KEY), { subtle }), TruncatedFile);
});

test('wrong key is detected as BadKey', async () => {
  const f = mkContainer(mkPlain(9000));
  await assert.rejects(decrypt(new Uint8Array(f), new Uint8Array(Buffer.from('fedcba9876543210')), subtle), BadKey);
});

test('abort signal stops decryption', async () => {
  const f = mkContainer(mkPlain(20 * 4096));
  const ac = new AbortController();
  await assert.rejects(decryptToBlob(new Blob([f]), new Uint8Array(KEY), { subtle, batchPages: 2, signal: ac.signal, onProgress: () => ac.abort() }), { name: 'AbortError' });
});

test('key JSON shapes and export', () => {
  const b64 = KEY.toString('base64');
  for (const shape of [{ a: b64 }, [{ id: 'a', key: b64 }], { results: [{ id: 'a', key: b64 }, { id: 'b', error: 'nope' }] }]) {
    for (const input of [shape, JSON.stringify(shape)]) assert.deepEqual(Buffer.from(parseKeyJson(input).a), KEY);
  }
  assert.throws(() => parseKeyJson('{"a":"AAAA"}'), /16/);
  assert.throws(() => parseKeyJson('{}'), /No keys/);
  assert.deepEqual(JSON.parse(exportKeysJson(parseKeyJson({ a: b64 }))), { a: b64 });
});

const resp = (status, body) => ({ ok: status < 300, status, json: async () => body });
const hdrs = (n) => Array.from({ length: n }, (_, i) => ({ id: 'id' + i }));

test('fetchKeys chunks by 20, retries 5xx, maps errors', async () => {
  const b64 = KEY.toString('base64'); const sizes = []; let flaky = 0;
  const fetchImpl = async (_u, o) => {
    const items = JSON.parse(o.body).items; sizes.push(items.length);
    if (sizes.length === 2 && !flaky++) return resp(503, {});
    return resp(200, { results: items.map((i) => ({ id: i.id, key: b64 })) });
  };
  const { keys } = await fetchKeys(hdrs(45), 't', { fetchImpl, sleep: async () => {} });
  assert.equal(Object.keys(keys).length, 45);
  assert.equal(sizes.filter((s) => s === 20).length, 3);
  const kind = (f) => fetchKeys(hdrs(1), 't', { fetchImpl: f, sleep: async () => {}, retries: 1 }).catch((e) => e);
  assert.equal((await kind(async () => resp(401, {}))).kind, 'expired');
  assert.equal((await kind(async () => resp(403, {}))).kind, 'forbidden');
  const net = await kind(async () => { throw new TypeError('Failed to fetch'); });
  assert.ok(net instanceof KeyFetchError); assert.equal(net.kind, 'network'); assert.match(net.message, /paste/);
});

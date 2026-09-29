# Encrypted clips (Tesla fw 2026.20+)

**Status: experimental and UNVERIFIED against real clips.** Everything below comes from the third-party
[XGxF3/tesla-dashcam-decrypt](https://github.com/XGxF3/tesla-dashcam-decrypt) write-up and script. The test suite
only proves the code matches that description (synthetic round-trips with Node `crypto`), not that Tesla's files match it.

## Format (as documented by the reference)

| Offset | Size | Field |
|---|---|---|
| 0x0000 | 8 | plaintext MP4 size, uint64 BE |
| 0x0008 / 0x000c | 4 + 4 | magic words (eCryptfs: `magic1 ^ magic2 == 0x3c81b7f5`; we only report this as `magicOk`) |
| 0x0010 | 4 | version / flags |
| 0x0014 | 4 | page size = 4096 |
| 0x0004 | 16 | "file id" used as API item id (see ambiguity) |
| 0x1000 | 4 | key_id (uint32 BE) |
| 0x1004 | 65 | public key (uncompressed EC point, starts with 0x04) |
| 0x1045 | 17 | VIN (ASCII) |
| 0x1056 | 8 | timestamp (uint64 BE) |
| 0x105e | 44 | wrapped key |
| 0x2000 | n*4096 | ciphertext pages: AES-128-CBC, no padding, IV = `MD5(MD5(key) \|\| ascii(page) zero-padded to 32 bytes)` |

**Known ambiguity:** the write-up lists both the plaintext size (0x00..0x08) and the 16 id bytes (0x04..0x14), which
overlap each other and the magic/version words. The reference script reads both anyway, so `parseHeader` does too:
`plainSize` from bytes 0..8, `id` from bytes 4..20. If real files show the API rejecting these ids, the id
location is the first thing to re-check (a hex dump of one real file settles it).

## What the code checks

- `parseHeader` throws typed errors: `NotEncrypted` (plain MP4, page size != 4096), `UnsupportedVersion` (public
  key not `0x04`, VIN not 17 alphanumerics, bad size), `TruncatedFile` (header or payload shorter than the size implies).
- After decrypting page 0 the output must start with an `ftyp`/`moov`/`mdat` box, otherwise `BadKey`. This is
  how a wrong key is detected (the AES layer has no integrity check).
- `decryptToBlob(file, key, {onProgress, signal})` decrypts in 1 MiB batches straight from `File.slice()`, yielding to
  the event loop between batches. All pages of a batch go through one WebCrypto call: CBC chaining would use the
  previous page's last block as IV, so the first 16 bytes of each page are XOR-corrected with `lastCt ^ iv`.
  One extra encrypt per batch fabricates the PKCS7 padding block WebCrypto insists on. Not moved to a Worker (yet).
- Keys: `fetchKeys` posts to `https://dashcam.tesla.com/api/1/decrypt/batch` in chunks of 20 with exponential
  backoff on network errors/429/5xx. 401 = expired token, 403 = not your clips, network/CORS failure = paste keys instead.
  The token stays in the input box (memory only, never stored). "Remember keys for this session" keeps keys in memory only.

## Getting keys

1. **Token flow (may be blocked by CORS in browsers):** log in at dashcam.tesla.com, DevTools > Network, drop a clip
   on the page, open any `/api/1/` request and copy the value after `Authorization: Bearer `. Paste it into the panel.
2. **Paste flow (always works):** run the reference script's key request yourself, or copy the response of
   `POST /api/1/decrypt/batch` from DevTools, and paste it in "key JSON". Accepted shapes: `{"<id>":"<base64>"}`,
   `[{"id":..,"key":..}]`, or the raw API response `{"results":[{"id":..,"key":..}]}`.
3. After a token fetch, "Export keys JSON" saves the keys for reuse (treat that file like a password).

## Still unverified

Header offsets and id location, the IV derivation, the API request shape and CORS behaviour, whether every real file
has whole 4096-byte final pages, and the eCryptfs magic constant. Roadmap P8 stays open until a real clip decrypts.

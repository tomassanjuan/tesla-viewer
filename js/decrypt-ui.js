// Encryption panel logic (ids: #crypt #cryptCount #token #fetchKeys #keyJson #useKeys #cryptMsg).
// EXPERIMENTAL, see docs/encryption.md. The token lives only in the input element (never persisted).
import { decryptToBlob, fetchKeys, parseKeyJson, exportKeysJson } from './tesla-crypto.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

/**
 * ctx: { encrypted: Map<File, header>, decrypted: Map<File, Blob>, onUnlocked(): void }
 * Returns { update() } to refresh the "N locked" line after files are (re)loaded.
 */
export function initDecryptUi(ctx) {
  const { encrypted, decrypted } = ctx;
  const msg = (t) => { $('cryptMsg').textContent = t; };
  const sessionKeys = {};                 // id -> Uint8Array, only kept when the checkbox is ticked
  let fetched = {}, abort = null;

  // Extra controls created in JS so index.html/style.css stay untouched.
  const progress = el('progress', { max: 1, value: 0, hidden: true });
  const cancel = el('button', { type: 'button', textContent: 'Cancel', hidden: true });
  const exportBtn = el('button', { type: 'button', textContent: 'Export keys JSON', hidden: true });
  const remember = el('input', { type: 'checkbox' });
  const rememberLbl = el('label'); rememberLbl.append(remember, ' Remember keys for this session (memory only)');
  $('cryptMsg').after(progress, cancel, exportBtn, rememberLbl);
  $('token').autocomplete = 'off';

  const locked = () => [...encrypted].filter(([f]) => !decrypted.has(f));
  function update() {
    const n = locked().length;
    $('cryptCount').textContent = encrypted.size ? `${n} of ${encrypted.size} encrypted clips still locked.` : 'No encrypted clips loaded.';
    if (n) $('crypt').open = true;
  }

  async function decryptAll(keys) {
    if (remember.checked) Object.assign(sessionKeys, keys);
    abort = new AbortController(); cancel.hidden = false; progress.hidden = false;
    const todo = locked(); let ok = 0, missing = 0; const bad = [];
    try {
      for (const [i, [f, h]] of todo.entries()) {
        const key = keys[h.id] ?? sessionKeys[h.id];
        if (!key) { missing++; continue; }
        msg(`Decrypting ${i + 1}/${todo.length}: ${f.name}`);
        try {
          decrypted.set(f, await decryptToBlob(f, key, { signal: abort.signal, onProgress: (x) => { progress.value = x; } }));
          ok++;
        } catch (e) {
          if (e.name === 'AbortError') { msg(`Cancelled after ${ok} clip(s).`); break; }
          bad.push(`${f.name}: ${e.name === 'BadKey' ? 'wrong key (output is not an MP4)' : e.message}`);
        }
      }
      if (!abort.signal.aborted) msg([`Decrypted ${ok}`, missing && `no key for ${missing}`, bad.length && `failed: ${bad.join('; ')}`].filter(Boolean).join(', ') + '.');
    } finally { cancel.hidden = true; progress.hidden = true; abort = null; }
    update();
    if (ok) ctx.onUnlocked?.();
  }

  cancel.onclick = () => abort?.abort();
  exportBtn.onclick = () => {
    const a = el('a', { href: URL.createObjectURL(new Blob([exportKeysJson(fetched)], { type: 'application/json' })), download: 'tesla-keys.json' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  $('fetchKeys').onclick = async () => {
    const token = $('token').value.trim();
    if (!token) return msg('Paste a bearer token first, or use pasted key JSON below.');
    const hs = locked().map(([, h]) => h);
    if (!hs.length) return msg('Nothing to unlock.');
    try {
      abort = new AbortController(); progress.hidden = false; cancel.hidden = false;
      msg(`Requesting keys for ${hs.length} clip(s)...`);
      const { keys, errors } = await fetchKeys(hs, token, { signal: abort.signal, onProgress: (x) => { progress.value = x; } });
      fetched = { ...fetched, ...keys }; exportBtn.hidden = !Object.keys(fetched).length;
      const ne = Object.keys(errors).length;
      if (ne) msg(`Tesla refused ${ne} key(s): ${Object.values(errors)[0]}`);
      await decryptAll(keys);
    } catch (e) {
      msg(e.name === 'AbortError' ? 'Cancelled.' : e.kind ? e.message : `${e.message}. If this is a network/CORS error, paste keys as JSON instead.`);
    } finally { progress.hidden = true; cancel.hidden = true; }
  };

  $('useKeys').onclick = () => {
    let keys;
    try { keys = parseKeyJson($('keyJson').value); } catch (e) { return msg('Bad key JSON: ' + e.message); }
    decryptAll(keys);
  };

  update();
  return { update };
}

// Sidebar version badge linking to the deployed commit on GitHub. Same-origin fetch only, no third-party request.
export const REPO = 'https://github.com/tomassanjuan/tesla-viewer';

/** {text, href} from build-time version.json ({version, sha}); falls back to the repo when unknown. */
export function versionLink(v) {
  const sha = /^[0-9a-f]{7,40}$/i.test(v?.sha ?? '') ? v.sha : '';
  const ver = /^[\w.+-]{1,20}$/.test(v?.version ?? '') ? `v${v.version}` : 'dev';
  return sha ? { text: `${ver} · ${sha.slice(0, 7)}`, href: `${REPO}/commit/${sha}` } : { text: ver, href: REPO };
}

if (typeof document !== 'undefined') {
  const a = document.getElementById('ver');
  if (a) fetch('version.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((v) => {
    const { text, href } = versionLink(v); a.textContent = text; a.href = href;
  });
}

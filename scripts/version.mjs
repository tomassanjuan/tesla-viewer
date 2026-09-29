// Build step (wrangler build.command): writes version.json with the deployed commit. Also stamps sw.js VERSION so each deploy gets a fresh cache. Missing env => local dev, sha omitted.
import { readFileSync, writeFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const sha = process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA || '';
writeFileSync(new URL('../version.json', import.meta.url), JSON.stringify({ version, sha }) + '\n');
if (sha) {
  const sw = new URL('../sw.js', import.meta.url);
  writeFileSync(sw, readFileSync(sw, 'utf8').replace(/^const VERSION = .*$/m, `const VERSION = '${sha.slice(0, 12)}';`));
}

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const directory = resolve(process.argv[2] ?? '');
if (process.argv[3] !== '--reviewed' || !directory.startsWith(join(repo, 'apps') + sep)
  || !directory.includes(`${sep}.local-visual${sep}`)) {
  throw new Error('Usage: node scripts/import-local-visual.mjs <app-local-run-directory> --reviewed');
}
const metadata = JSON.parse(readFileSync(join(directory, 'candidate.json'), 'utf8'));
if (!['financial', 'blog', 'zboard', 'tavern', 'images'].includes(metadata.app)
  || !directory.startsWith(join(repo, 'apps', metadata.app, '.local-visual') + sep)) throw new Error('Invalid app candidate');
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repo })
  .toString().split('\0').filter(path => path && existsSync(join(repo, path))))].sort();
const digest = createHash('sha256');
for (const path of files) digest.update(path).update('\0').update(readFileSync(join(repo, path)));
if (digest.digest('hex') !== metadata.sourceDigest) throw new Error('Source changed after capture; regenerate screenshots');
if (!metadata.screenshots?.length) throw new Error('No screenshots to import');
for (const entry of metadata.screenshots) {
  const prefix = metadata.app === 'financial'
    ? 'apps/financial/e2e/__screenshots__/linux-ci-'
    : `apps/${metadata.app}/e2e/__screenshots__/linux-ci/`;
  if (isAbsolute(entry.baseline) || !entry.baseline.startsWith(prefix)
    || entry.baseline.split('/').includes('..') || entry.review.split('/').includes('..')) throw new Error('Invalid candidate path');
  const source = join(directory, entry.review);
  if (!entry.review.startsWith('review/') || createHash('sha256').update(readFileSync(source)).digest('hex') !== entry.sha256) {
    throw new Error('Candidate checksum mismatch: ' + entry.review);
  }
  mkdirSync(dirname(join(repo, entry.baseline)), { recursive: true });
  copyFileSync(source, join(repo, entry.baseline));
}
console.log('Imported ' + metadata.screenshots.length + ' reviewed Linux baselines. Inspect git diff before committing.');

import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = new Set(process.argv.slice(2).filter(arg => !arg.startsWith('--reviewed-path=')));
const reviewedPaths = new Set(process.argv.slice(2).filter(arg => arg.startsWith('--reviewed-path='))
  .map(arg => arg.slice('--reviewed-path='.length)));
if ([...args].some(arg => !['--validated', '--backend-reviewed', '--dry-run'].includes(arg)) || reviewedPaths.has('')) {
  throw new Error('Use --validated --backend-reviewed and one --reviewed-path=<file> per non-document file.');
}
const git = (...parts) => execFileSync('git', parts, { cwd: root, encoding: 'utf8' }).trim();
git('fetch', 'origin', 'main');
if (git('status', '--porcelain')) throw new Error('Commit task files and keep the worktree clean before direct push.');
try { git('merge-base', '--is-ancestor', 'origin/main', 'HEAD'); }
catch { throw new Error('Branch must be based on the current origin/main. Integrate latest main first.'); }
const files = git('diff', '--name-only', 'origin/main..HEAD', '--').split('\n').filter(Boolean);
if (!files.length) throw new Error('No commits to push.');
const docs = path => path.startsWith('docs/') || path.includes('/docs/')
  || path.endsWith('/README.md') || path === 'README.md' || path === 'AGENTS.md'
  || /^[A-Z][A-Z-]+\.md$/.test(path);
const maintenance = path => ['scripts/', 'apps/financial/scripts/', 'apps/blog/scripts/', 'apps/zboard/scripts/'].some(prefix => path.startsWith(prefix))
  && !/(scripts\/ci\/|direct-push|visual|browser-build|baselines)/.test(path);
const backend = path => ['database/', 'apps/financial/worker/', 'apps/blog/worker/', 'apps/zboard/worker/'].some(prefix => path.startsWith(prefix));
const denied = files.filter(path => !docs(path)
  && !(args.has('--backend-reviewed') && (maintenance(path) || backend(path))));
if (denied.length) throw new Error('A PR with CI is required for these files:\n' + denied.join('\n'));
const nonDocs = files.filter(path => !docs(path));
if (nonDocs.some(path => !reviewedPaths.has(path)) || [...reviewedPaths].some(path => !nonDocs.includes(path))) {
  throw new Error('List each reviewed non-document file exactly with --reviewed-path=<file>:\n' + nonDocs.join('\n'));
}
if (files.some(path => !docs(path)) && !args.has('--validated')) throw new Error('Run relevant local checks, then pass --validated.');
git('diff', '--check', 'origin/main..HEAD');
console.log(files.join('\n'));
if (args.has('--dry-run')) { console.log('Eligible for a fast-forward direct push.'); process.exit(0); }
const pushed = spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/main'], { cwd: root, stdio: 'inherit' });
if (pushed.status !== 0) throw new Error('Direct push failed; main may have advanced or protection may reject this actor.');
const remote = git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0];
if (remote !== git('rev-parse', 'HEAD')) throw new Error('Remote main does not match the pushed commit.');
console.log('Direct push verified on origin/main:', remote);

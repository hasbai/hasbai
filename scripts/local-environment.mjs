import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const apps = ['financial', 'blog', 'zboard', 'tavern', 'images'];
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const expectedPnpm = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager.split('@')[1];

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
  });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed.`);
  return result.stdout?.trim();
}

function info() {
  console.log(`Node ${process.version}; pnpm ${run(pnpm, ['--version'], true)} (required ${expectedPnpm})`);
  const manifest = join(root, 'apps/financial/node_modules/wrangler/package.json');
  const wrangler = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).version : 'not installed; run setup';
  console.log(`Wrangler ${wrangler}; dependency versions: pnpm-workspace.yaml catalog`);
  console.log(run('git', ['status', '--short', '--branch'], true));
  for (const [index, app] of apps.entries()) {
    console.log(`${app}: apps/${app}; port ${5173 + index}; docs/${app}/README.md`);
  }
  console.log('Rules: AGENTS.md; checks/delivery: docs/TESTING.md; navigation: docs/README.md');
  console.log('Root dev/test/build/typecheck target financial. Other apps: pnpm --filter <app> <script>.');
  console.log('Zboard/Tavern API: node scripts/local-environment.mjs api <zboard|tavern> (build first; port 8787, one at a time).');
  console.log('Zboard native tests require the pinned, SHA-256-verified MIHOMO_BIN; see docs/TESTING.md.');
  console.log('Full Playwright: CI. Page screenshots: existing visual:* actions with the pinned Linux image.');
}

try {
  switch (process.argv[2]) {
    case 'setup': {
      if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24, matching CI.');
      const actual = run(pnpm, ['--version'], true);
      if (actual !== expectedPnpm) throw new Error(`Use pnpm ${expectedPnpm}; found ${actual}.`);
      run(pnpm, ['install', '--frozen-lockfile']);
      info();
      break;
    }
    case 'info':
      info();
      break;
    case 'api': {
      const app = process.argv[3];
      if (!['zboard', 'tavern'].includes(app)) throw new Error('API app must be zboard or tavern.');
      run(pnpm, ['--filter', app, 'build']);
      run(pnpm, ['--dir', `apps/${app}`, 'exec', 'wrangler', 'dev', '--port', '8787', '--local']);
      break;
    }
    case 'cleanup': {
      // Only disposable build outputs. Keep dependencies, credentials, local data and review evidence.
      for (const app of apps) {
        const directory = join(root, 'apps', app);
        if (lstatSync(join(root, 'apps')).isSymbolicLink() || lstatSync(directory).isSymbolicLink()) {
          throw new Error(`Refusing cleanup through a symlink: apps/${app}`);
        }
        for (const output of ['dist', 'dist-e2e', 'coverage', '.svelte-kit']) {
          const relative = `apps/${app}/${output}`;
          const path = join(root, relative);
          if (!existsSync(path)) continue;
          if (run('git', ['ls-files', '--', relative], true)) throw new Error(`Refusing to remove tracked files: ${relative}`);
          rmSync(path, { recursive: true, force: true });
          console.log(`Removed ${relative}`);
        }
      }
      console.log('Cleanup complete; dependencies, local data, credentials and test/visual evidence retained.');
      break;
    }
    default:
      throw new Error('Usage: node scripts/local-environment.mjs <setup|info|cleanup|api zboard|api tavern>');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

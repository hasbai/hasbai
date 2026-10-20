import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const appName = process.argv[2];
if (!['financial', 'blog', 'zboard', 'tavern', 'images'].includes(appName)) throw new Error('Expected financial, blog, zboard or tavern');
const app = resolve(repo, 'apps', appName);
const manifest = JSON.parse(readFileSync(resolve(app, 'visual-coverage.json'), 'utf8'));
const ids = new Set(process.argv.slice(3));
const all = ids.delete('--all');
const scenarios = manifest.scenarios.filter(scenario => all || ids.has(scenario.id));
if (!scenarios.length || (!all && scenarios.length !== ids.size)) throw new Error('Unknown or empty scenario selection');

const runRoot = resolve(app, '.local-visual', new Date().toISOString().replaceAll(':', '-'));
const capture = resolve(runRoot, 'capture');
const review = resolve(runRoot, 'review');
mkdirSync(capture, { recursive: true });
mkdirSync(review, { recursive: true });
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { cwd: app, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status ?? result.error})`);
};
run('pnpm', ['build']);
const e2eEnv = appName === 'financial'
  ? { VITE_DATA_API_URL: 'http://127.0.0.1:4173/test-api' }
  : appName === 'blog'
    ? { PUBLIC_DATA_API_URL: 'http://127.0.0.1:4180/rest/v1', PUBLIC_ANONYMOUS_AUTH_URL: 'http://127.0.0.1:4180/auth' }
    : {};
run('pnpm', ['exec', 'vite', 'build', '--mode', 'e2e'], { ...process.env, ...e2eEnv });
if (appName !== 'blog') run('node', [appName === 'financial' ? 'scripts/prepare-browser-build.mjs' : '../financial/scripts/prepare-browser-build.mjs']);

const tasks = new Map();
for (const scenario of scenarios) for (const evidence of scenario.evidence ?? []) {
  for (const project of evidence.projects ?? []) {
    const key = JSON.stringify([evidence.spec, project]);
    if (!tasks.has(key)) tasks.set(key, { spec: evidence.spec, project, tests: new Set() });
    tasks.get(key).tests.add(evidence.test);
  }
}
const captureEnv = { ...process.env, ...e2eEnv, LOCAL_VISUAL_CAPTURE_DIR: capture };
if (all) run('pnpm', ['exec', 'playwright', 'test', '--update-snapshots=all'], { ...captureEnv, VISUAL_COVERAGE_GATE: '1' });
else for (const { spec, project, tests } of tasks.values()) {
  const grep = [...tests].map(test => test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  run('pnpm', ['exec', 'playwright', 'test', spec, '--project', project, '--grep', grep, '--update-snapshots=all'], captureEnv);
}

let count = 0;
const listed = new Set();
for (const scenario of scenarios) for (const evidence of scenario.evidence ?? []) {
  for (const project of evidence.projects ?? []) for (const snapshot of evidence.snapshots ?? []) {
    const source = resolve(capture, project, ...(appName === 'financial' ? [basename(evidence.spec)] : []), snapshot);
    if (!existsSync(source)) throw new Error(`Expected screenshot missing: ${source}`);
    listed.add(relative(capture, source));
    const destination = resolve(review, scenario.id, project, snapshot);
    mkdirSync(resolve(review, scenario.id, project), { recursive: true });
    cpSync(source, destination);
    count++;
  }
}
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(item => {
  const path = resolve(dir, item.name);
  return item.isDirectory() ? walk(path) : [path];
});
for (const source of walk(capture).filter(path => path.endsWith('.png'))) {
  const path = relative(capture, source);
  if (listed.has(path)) continue;
  const destination = resolve(review, '_additional', path);
  mkdirSync(resolve(destination, '..'), { recursive: true });
  cpSync(source, destination);
  count++;
}
console.log(`Captured ${count} screenshots in ${review}`);

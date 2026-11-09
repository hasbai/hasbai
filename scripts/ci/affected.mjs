import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const APPS = ['financial', 'blog', 'zboard', 'tavern', 'images', 'ai', 'wechat'];

// Changes here affect every app, including the CI wiring itself.
const SHARED = /^(packages\/|\.github\/workflows\/(ci|automerge)\.yml$|scripts\/ci\/|docker\/visual-ci\/|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|package\.json$|scripts\/(visual-linux|visual-capture|import-local-visual)\.mjs$|apps\/financial\/scripts\/(check-visual-coverage|prepare-browser-build)\.mjs$)/;

const owns = (app, path) => path.startsWith(`apps/${app}/`)
  || path === `.github/workflows/${app}.yml`
  || path.startsWith(`database/${app}/`)
  || (app === 'financial' && path.startsWith('database/migrations/'));

// Path rules set the minimum scope. Labels `ci:<app>` and `ci:all` only widen it.
export function plan({ files, labels = [], all = false }) {
  const declared = new Set(labels.map(label => label.trim()));
  const everything = all || declared.has('ci:all') || files.some(path => SHARED.test(path));
  return Object.fromEntries(APPS.map(app => [
    app,
    everything || declared.has(`ci:${app}`) || files.some(path => owns(app, path)),
  ]));
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { CI_BASE_SHA: base, CI_LABELS: labels = '', GITHUB_EVENT_NAME: event } = process.env;
  const all = event !== 'pull_request' || !base;
  const files = all ? [] : git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
  const result = plan({ files, labels: labels.split('\n').filter(Boolean), all });
  for (const [app, affected] of Object.entries(result)) {
    const line = `${app}=${affected}\n`;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
    else process.stdout.write(line);
  }
}

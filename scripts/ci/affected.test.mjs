import assert from 'node:assert/strict';
import test from 'node:test';
import { APPS, plan } from './affected.mjs';

const only = (...apps) => Object.fromEntries(APPS.map(app => [app, apps.includes(app)]));

test('app paths select only that app', () => {
  assert.deepEqual(plan({ files: ['apps/blog/src/a.ts'] }), only('blog'));
  assert.deepEqual(plan({ files: ['database/tavern/001.sql'] }), only('tavern'));
  assert.deepEqual(plan({ files: ['database/migrations/001.sql'] }), only('financial'));
  assert.deepEqual(plan({ files: ['.github/workflows/zboard.yml'] }), only('zboard'));
});

test('documentation selects no app', () => {
  assert.deepEqual(plan({ files: ['docs/TESTING.md', 'AGENTS.md', ] }), only());
});

test('shared paths select every app', () => {
  for (const path of ['packages/ui/a.ts', 'scripts/ci/gate.mjs', '.github/workflows/ci.yml', '.github/workflows/automerge.yml', 'pnpm-lock.yaml', 'package.json', 'scripts/visual-linux.mjs', 'apps/financial/scripts/check-visual-coverage.mjs']) {
    assert.deepEqual(plan({ files: [path] }), only(...APPS), path);
  }
});

test('labels only widen the path scope', () => {
  assert.deepEqual(plan({ files: ['apps/blog/a.ts'], labels: ['ci:ai'] }), only('blog', 'ai'));
  assert.deepEqual(plan({ files: ['docs/a.md'], labels: ['ci:all'] }), only(...APPS));
  assert.deepEqual(plan({ files: ['apps/blog/a.ts'], labels: ['bug', 'ci:none'] }), only('blog'));
});

test('dispatch runs every app', () => {
  assert.deepEqual(plan({ files: [], all: true }), only(...APPS));
});

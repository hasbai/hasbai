import assert from 'node:assert/strict';
import test from 'node:test';
import { APPS } from './affected.mjs';
import { verify } from './gate.mjs';

const plan = (...apps) => Object.fromEntries(APPS.map(app => [app, String(apps.includes(app))]));
const needs = (results, changes = 'success') => ({ changes: { result: changes }, ...Object.fromEntries(Object.entries(results).map(([app, result]) => [app, { result }])) });
const results = (planned, state = 'success') => Object.fromEntries(APPS.map(app => [app, planned.includes(app) ? state : 'skipped']));

test('passes when planned apps succeed and the rest are skipped', () => {
  verify(plan('blog'), needs(results(['blog'])));
  verify(plan(), needs(results([])));
});

test('fails for failed, cancelled, skipped or missing planned apps', () => {
  for (const state of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.throws(() => verify(plan('blog'), needs({ ...results(['blog']), blog: state })), /blog: expected success/);
  }
});

test('fails when an unplanned app ran or change analysis failed', () => {
  assert.throws(() => verify(plan(), needs({ ...results([]), ai: 'success' })), /ai: expected skipped/);
  assert.throws(() => verify(plan(), needs(results([]), 'failure')), /Change analysis/);
  assert.throws(() => verify({ ...plan(), ai: undefined }, needs(results([]))), /Invalid change plan/);
});

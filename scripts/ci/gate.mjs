import { pathToFileURL } from 'node:url';
import { APPS } from './affected.mjs';

// A planned app must succeed; an unplanned app must be skipped. Cancelled, failed or missing results fail the gate.
export function verify(plan, needs) {
  if (needs.changes?.result !== 'success') throw new Error('Change analysis did not pass.');
  for (const app of APPS) {
    if (!['true', 'false'].includes(plan[app])) throw new Error(`Invalid change plan for ${app}.`);
  }
  for (const app of APPS) {
    const expected = plan[app] === 'true' ? 'success' : 'skipped';
    if (needs[app]?.result !== expected) throw new Error(`${app}: expected ${expected}, received ${needs[app]?.result}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verify(JSON.parse(process.env.CI_PLAN), JSON.parse(process.env.CI_NEEDS));
  console.log('All planned app checks passed.');
}

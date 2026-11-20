#!/usr/bin/env node
/**
 * CI Gate: the single check that branch protection should require.
 *
 * Why it exists: GitHub counts a job that was SKIPPED as passing a required check, so with the individual jobs required, a
 * failed `changes` job (which makes Server Validation, Playwright E2E and the soak "skipped") or a wrongly skipped job reads as
 * green. This job runs `if: always()` after every real job and decides from their results:
 *
 *   always-on jobs        must be `success`
 *   changes               must be `success`, and its outputs must say what the diff needs
 *   Playwright E2E        `success` when changes says e2e_required=true, otherwise `skipped` or `success`
 *   Server Validation and
 *   MP Private Soak       `success` when changes says server_required=true, otherwise `skipped`
 *   anything else (failure, cancelled, missing from `needs`)    fails the gate
 *
 * A docs-only PR therefore passes with E2E / Server Validation / the soak skipped, because `changes` said they were not needed;
 * the same skips after a broken `changes` job fail the gate. Reads the `needs` context as JSON from NEEDS_JSON.
 *
 *   NEEDS_JSON='{"changes":{"result":"success","outputs":{...}},...}' node scripts/ciGate.mjs
 */
import { pathToFileURL } from 'node:url';

export const ALWAYS_ON = ['changes', 'lint-and-static', 'unit-tests', 'build-and-audit', 'mobile-reachability'];
export const E2E_JOBS = ['e2e'];
export const SERVER_JOBS = ['server', 'mp-private-soak'];
export const ALL_JOBS = [...ALWAYS_ON, ...E2E_JOBS, ...SERVER_JOBS];

/** @param {Record<string, {result?: string, outputs?: Record<string, string>}>} needs */
export function evaluateGate(needs) {
  const problems = [];
  const resultOf = (job) => needs?.[job]?.result;
  const expect = (job, allowed, why) => {
    const result = resultOf(job);
    if (result === undefined) problems.push(`${job}: missing from the gate's needs (${why})`);
    else if (!allowed.includes(result)) problems.push(`${job}: ${result}, expected ${allowed.join(' or ')} (${why})`);
  };

  for (const job of ALWAYS_ON) expect(job, ['success'], 'always required');

  const outputs = needs?.changes?.outputs ?? {};
  const flag = (name) => (outputs[name] === 'true' ? true : outputs[name] === 'false' ? false : null);
  const e2eRequired = flag('e2e_required');
  const serverRequired = flag('server_required');
  if (e2eRequired === null) problems.push(`changes: output e2e_required is "${outputs.e2e_required ?? ''}", expected true or false`);
  if (serverRequired === null) problems.push(`changes: output server_required is "${outputs.server_required ?? ''}", expected true or false`);

  for (const job of E2E_JOBS) {
    if (e2eRequired === null) expect(job, ['success'], 'needs unknown, so it must have run');
    else if (e2eRequired) expect(job, ['success'], 'changes said e2e_required=true');
    else expect(job, ['skipped', 'success'], 'changes said e2e_required=false');
  }
  for (const job of SERVER_JOBS) {
    if (serverRequired === null) expect(job, ['success'], 'needs unknown, so it must have run');
    else if (serverRequired) expect(job, ['success'], 'changes said server_required=true');
    else expect(job, ['skipped'], 'changes said server_required=false');
  }

  const extra = Object.keys(needs ?? {}).filter((job) => !ALL_JOBS.includes(job));
  for (const job of extra) expect(job, ['success', 'skipped'], 'a job this gate does not know about: add it to ciGate.mjs');
  return { ok: problems.length === 0, problems };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let needs;
  try {
    needs = JSON.parse(process.env.NEEDS_JSON ?? '');
  } catch {
    console.error('CI Gate: NEEDS_JSON is missing or not JSON.');
    process.exit(1);
  }
  const { ok, problems } = evaluateGate(needs);
  for (const job of Object.keys(needs)) console.log(`${job.padEnd(22)} ${needs[job].result}`);
  if (!ok) {
    console.error(`\nCI Gate FAILED:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('\nCI Gate passed.');
}

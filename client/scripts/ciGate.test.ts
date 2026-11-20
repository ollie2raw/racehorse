import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs script, no type declarations
import { ALL_JOBS, evaluateGate } from './ciGate.mjs';

type Needs = Record<string, { result: string; outputs?: Record<string, string> }>;

const everything: Needs = {
  changes: { result: 'success', outputs: { e2e_required: 'true', server_required: 'true' } },
  'lint-and-static': { result: 'success' },
  'unit-tests': { result: 'success' },
  'build-and-audit': { result: 'success' },
  'mobile-reachability': { result: 'success' },
  e2e: { result: 'success' },
  server: { result: 'success' },
  'mp-private-soak': { result: 'success' },
};
const docsOnly: Needs = {
  ...everything,
  changes: { result: 'success', outputs: { e2e_required: 'false', server_required: 'false' } },
  e2e: { result: 'skipped' },
  server: { result: 'skipped' },
  'mp-private-soak': { result: 'skipped' },
};
const with_ = (base: Needs, patch: Needs): Needs => ({ ...base, ...patch });

describe('CI Gate decisions', () => {
  it('passes when everything ran and passed', () => {
    expect(evaluateGate(everything)).toEqual({ ok: true, problems: [] });
  });

  it('passes a docs-only PR: E2E, Server Validation and the soak are skipped because `changes` said so', () => {
    expect(evaluateGate(docsOnly)).toEqual({ ok: true, problems: [] });
  });

  it('passes a PR that needs E2E but not the server tests', () => {
    const needs = with_(docsOnly, { changes: { result: 'success', outputs: { e2e_required: 'true', server_required: 'false' } }, e2e: { result: 'success' } });
    expect(evaluateGate(needs).ok).toBe(true);
  });

  it.each(['lint-and-static', 'unit-tests', 'build-and-audit', 'mobile-reachability', 'e2e', 'server', 'mp-private-soak'])(
    'fails when %s fails',
    (job) => {
      const result = evaluateGate(with_(everything, { [job]: { result: 'failure' } }));
      expect(result.ok).toBe(false);
      expect(result.problems.join()).toContain(job);
    },
  );

  it.each(['lint-and-static', 'unit-tests', 'build-and-audit', 'mobile-reachability'])('fails when the always-on job %s is skipped or cancelled', (job) => {
    expect(evaluateGate(with_(everything, { [job]: { result: 'skipped' } })).ok).toBe(false);
    expect(evaluateGate(with_(everything, { [job]: { result: 'cancelled' } })).ok).toBe(false);
  });

  it('fails when a job that `changes` said was required was skipped', () => {
    expect(evaluateGate(with_(everything, { e2e: { result: 'skipped' } })).ok).toBe(false);
    expect(evaluateGate(with_(everything, { server: { result: 'skipped' } })).ok).toBe(false);
    expect(evaluateGate(with_(everything, { 'mp-private-soak': { result: 'skipped' } })).ok).toBe(false);
  });

  it('fails when `changes` itself failed (its dependents read as skipped, which GitHub counts as passing)', () => {
    const broken = with_(docsOnly, { changes: { result: 'failure', outputs: {} } });
    const result = evaluateGate(broken);
    expect(result.ok).toBe(false);
    expect(result.problems.join()).toContain('changes: failure');
  });

  it('fails when `changes` succeeded but gave no usable output', () => {
    const result = evaluateGate(with_(docsOnly, { changes: { result: 'success', outputs: {} } }));
    expect(result.ok).toBe(false);
  });

  it('fails when the server jobs are skipped while E2E ran (a half-skipped diff the allow-list never produces)', () => {
    const needs = with_(everything, { changes: { result: 'success', outputs: { e2e_required: 'true', server_required: 'false' } }, server: { result: 'success' } });
    expect(evaluateGate(needs).ok).toBe(false); // server must be skipped when server_required=false
  });

  it('fails when a needed job is missing from the needs object', () => {
    const { e2e: _omitted, ...rest } = everything;
    expect(evaluateGate(rest).ok).toBe(false);
  });

  it('fails on a job it does not know about that failed, so a new job cannot be added silently red', () => {
    expect(evaluateGate(with_(everything, { 'new-job': { result: 'failure' } })).ok).toBe(false);
  });
});

describe('the workflow wires the gate to every job', () => {
  const workflow = readFileSync(join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  const jobsSection = workflow.slice(workflow.indexOf('\njobs:'));
  const jobIds = [...jobsSection.matchAll(/^ {2}([a-z0-9-]+):\s*$/gm)].map((m) => m[1]).filter((id) => id !== 'ci-gate');
  const gateBlock = workflow.slice(workflow.indexOf('\n  ci-gate:'));

  it('lists every other job of ci.yml in the gate\'s needs', () => {
    expect(jobIds.length).toBeGreaterThan(5);
    const needsLine = gateBlock.match(/needs:\s*\[([^\]]*)\]/)?.[1] ?? '';
    const needed = needsLine.split(',').map((s) => s.trim()).filter(Boolean);
    expect([...needed].sort()).toEqual([...jobIds].sort());
  });

  it('knows exactly the jobs ci.yml defines', () => {
    expect([...ALL_JOBS].sort()).toEqual([...jobIds].sort());
  });

  it('runs even when needed jobs fail or are skipped, and is named CI Gate', () => {
    expect(gateBlock).toMatch(/if:\s*always\(\)/);
    expect(gateBlock).toMatch(/name:\s*CI Gate/);
  });
});

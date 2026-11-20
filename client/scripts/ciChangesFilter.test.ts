import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Runs the REAL "Determine which heavy jobs this diff needs" step from ci.yml against throwaway git repos, so the
// docs-only filter is tested as shipped, not as a copy of it.
const workflow = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8');
const stepAt = workflow.indexOf('name: Determine which heavy jobs this diff needs');
const runAt = workflow.indexOf('run: |\n', stepAt) + 'run: |\n'.length;
const endAt = workflow.indexOf('\n  e2e:', runAt);
const script = workflow
  .slice(runAt, endAt)
  .split('\n')
  .map((l) => l.replace(/^ {10}/, ''))
  .join('\n')
  .replace('${{ github.event_name }}', 'pull_request');

const roots: string[] = [];
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }).trim();

function classify(setup: (cwd: string) => void): { e2e: string; server: string } {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-changes-'));
  roots.push(cwd);
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 't@example.com');
  git(cwd, 'config', 'user.name', 't');
  const put = (rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    fs.writeFileSync(path.join(cwd, rel), body);
  };
  // Distinct, multi-line content so git's similarity detection WOULD pair a moved file with its new path.
  const body = Array.from({ length: 30 }, (_, i) => `line ${i} of a real source file`).join('\n');
  put('server/workers/reviewSearchWorker.cjs', body);
  put('babel.config.js', body);
  put('docs/readme.md', 'x');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'base');
  const base = git(cwd, 'rev-parse', 'HEAD');
  setup(cwd);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'head');
  const head = git(cwd, 'rev-parse', 'HEAD');
  const out = path.join(cwd, 'gh-output');
  fs.writeFileSync(out, '');
  execFileSync('bash', ['-c', script], { cwd, env: { ...process.env, BASE_SHA: base, HEAD_SHA: head, GITHUB_OUTPUT: out }, stdio: 'pipe' });
  const o = Object.fromEntries(fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => l.split('=')));
  return { e2e: o.e2e_required, server: o.server_required };
}

afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

describe('ci.yml docs-only filter', () => {
  it('extracted the step', () => {
    expect(script).toContain('git diff');
    expect(script).toContain('GITHUB_OUTPUT');
  });

  it('a docs-only diff skips E2E and Server Validation (the filter still works)', () => {
    const r = classify((cwd) => fs.writeFileSync(path.join(cwd, 'docs/new.md'), 'hello'));
    expect(r).toEqual({ e2e: 'false', server: 'false' });
  });

  it('E2: moving server code into docs/ (rename) still requires everything', () => {
    const r = classify((cwd) => {
      fs.mkdirSync(path.join(cwd, 'docs/attic'), { recursive: true });
      git(cwd, 'mv', 'server/workers/reviewSearchWorker.cjs', 'docs/attic/reviewSearchWorker.cjs');
    });
    expect(r).toEqual({ e2e: 'true', server: 'true' });
  });

  it('E2: a root file renamed to a root .md still requires everything', () => {
    const r = classify((cwd) => git(cwd, 'mv', 'babel.config.js', 'NOTES.md'));
    expect(r).toEqual({ e2e: 'true', server: 'true' });
  });

  it('E2: rename plus small edits (still detected as a rename) still requires everything', () => {
    const r = classify((cwd) => {
      fs.mkdirSync(path.join(cwd, 'docs/attic'), { recursive: true });
      git(cwd, 'mv', 'server/workers/reviewSearchWorker.cjs', 'docs/attic/worker.md');
      fs.appendFileSync(path.join(cwd, 'docs/attic/worker.md'), '\nnote\n');
    });
    expect(r).toEqual({ e2e: 'true', server: 'true' });
  });

  it('a docs-to-docs rename is still docs-only (both paths are allowed)', () => {
    const r = classify((cwd) => git(cwd, 'mv', 'docs/readme.md', 'docs/guide.md'));
    expect(r).toEqual({ e2e: 'false', server: 'false' });
  });

  it('a pure deletion of server code requires everything (unchanged)', () => {
    const r = classify((cwd) => git(cwd, 'rm', '-q', 'server/workers/reviewSearchWorker.cjs'));
    expect(r).toEqual({ e2e: 'true', server: 'true' });
  });
});

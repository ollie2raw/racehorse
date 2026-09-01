import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// assert_security_posture() is the prod schema-drift detector behind
// .github/workflows/security-posture.yml. There is no CI Postgres, so this
// test locks the migration's *content* — the three hard-fail checks, the
// advisory checks, and the service-role-only lockdown. A real "plant a
// violation, confirm it's caught" run is done by PR-G's local pg16 script.

const migrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/2026-09-01_assert_security_posture_rpc.sql',
);
const workflowPath = path.resolve(
  __dirname,
  '../../.github/workflows/security-posture.yml',
);

function sql(): string {
  return fs.readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase();
}

describe('assert_security_posture() migration', () => {
  it('is SECURITY DEFINER with a pinned search_path and returns jsonb', () => {
    const s = sql();
    expect(s).toContain('create or replace function public.assert_security_posture()');
    expect(s).toContain('returns jsonb');
    expect(s).toContain('security definer');
    expect(s).toContain('set search_path = public, pg_temp');
  });

  it('hard-fails on RLS-disabled public tables', () => {
    const s = sql();
    expect(s).toContain("'check','rls_disabled'");
    expect(s).toContain('c.relrowsecurity is false');
  });

  it('hard-fails on SECURITY DEFINER functions with a mutable search_path', () => {
    const s = sql();
    expect(s).toContain("'check','securitydefiner_mutable_search_path'");
    expect(s).toContain("cfg like 'search_path=%'");
  });

  it('hard-fails on client write grants where RLS is also off', () => {
    const s = sql();
    expect(s).toContain("'check','client_write_grant_rls_off'");
  });

  it('reports (advisory, not fail) client write grants on RLS-enabled tables and client-executable SECURITY DEFINER functions', () => {
    const s = sql();
    expect(s).toContain("'check','client_write_grant_rls_on'");
    expect(s).toContain("'check','securitydefiner_client_executable'");
    // proacl-null must still count as client-executable (PG default is EXECUTE to PUBLIC)
    expect(s).toContain('p.proacl is null');
  });

  it('returns a hard_fail_count the cron can branch on, separate from advisories', () => {
    const s = sql();
    expect(s).toContain("'hard_fail_count'");
    expect(s).toContain("'advisory_count'");
  });

  it('the suppression list can only quiet advisories', () => {
    const s = sql();
    // The list is *used* exactly once, in the ADVISORY 2 predicate — never in a
    // hard-fail query. (The name also appears in the header comment + declare
    // block; those don't gate anything.)
    const uses = s.match(/all\(intentional_client_rpcs\)/g) ?? [];
    expect(uses).toHaveLength(1);
    const useIdx = s.indexOf('all(intentional_client_rpcs)');
    const hard3End = s.indexOf('-- advisory 1');
    expect(useIdx).toBeGreaterThan(hard3End); // strictly after every hard-fail block
  });

  it('is executable by service_role only', () => {
    const s = sql();
    expect(s).toContain(
      'revoke execute on function public.assert_security_posture() from public, anon, authenticated',
    );
    expect(s).toContain(
      'grant execute on function public.assert_security_posture() to service_role',
    );
  });
});

describe('security-posture workflow', () => {
  const wf = fs.readFileSync(workflowPath, 'utf8');

  it('runs weekly and on manual dispatch', () => {
    expect(wf).toContain('cron:');
    expect(wf).toContain('workflow_dispatch:');
  });

  it('calls the RPC with the existing service-key secret and never echoes it', () => {
    expect(wf).toContain('${{ secrets.SUPABASE_SERVICE_KEY }}');
    expect(wf).toContain('/rest/v1/rpc/assert_security_posture');
    expect(wf).not.toMatch(/echo\s+["']?\$SUPABASE_SERVICE_KEY/);
    expect(wf).not.toContain('set -x');
  });

  it('fails the job on hard failures, warns on advisories', () => {
    expect(wf).toMatch(/hard.*-gt 0/s);
    expect(wf).toContain('exit 1');
    expect(wf).toMatch(/adv.*-gt 0/s);
  });
});

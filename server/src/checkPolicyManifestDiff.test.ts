import { describe, expect, it } from 'vitest';
import {
  diffPolicyManifest,
  type LivePolicyRow,
  type PolicyManifest,
} from '../scripts/checkPolicyManifest';

/**
 * Guardrail #1 (ENGINEERING_GUARDRAILS.md) — proves the diff logic actually
 * catches the RK-0 class of drift (a policy named for one role but live-
 * scoped to another), not just that the script runs without error.
 */

const manifest: PolicyManifest = {
  tables: {
    ranked_games: {
      policies: [
        {
          policyname: 'Service role can insert ranked games',
          cmd: 'INSERT',
          roles: ['service_role'],
          qual: null,
          with_check: 'true',
        },
      ],
    },
  },
};

describe('diffPolicyManifest', () => {
  it('is clean when the live policy exactly matches the manifest', () => {
    const live: LivePolicyRow[] = [
      {
        schemaname: 'public',
        tablename: 'ranked_games',
        policyname: 'Service role can insert ranked games',
        cmd: 'INSERT',
        roles: ['service_role'],
        qual: null,
        with_check: 'true',
      },
    ];

    const result = diffPolicyManifest(live, manifest);
    expect(result.findings).toEqual([]);
    expect(result.checkedTables).toEqual(['ranked_games']);
  });

  it('FAILS the check when a policy is deliberately mis-scoped — the exact RK-0 shape (roles drifted from service_role to public)', () => {
    const live: LivePolicyRow[] = [
      {
        schemaname: 'public',
        tablename: 'ranked_games',
        policyname: 'Service role can insert ranked games',
        cmd: 'INSERT',
        // The actual RK-0 drift: named for service_role, live-scoped to public.
        roles: ['public'],
        qual: null,
        with_check: 'true',
      },
    ];

    const result = diffPolicyManifest(live, manifest);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      table: 'ranked_games',
      kind: 'mismatched_policy',
      policyname: 'Service role can insert ranked games',
    });
    expect(result.findings[0]!.detail).toContain('service_role');
    expect(result.findings[0]!.detail).toContain('public');
  });

  it('FAILS when a pinned policy is missing entirely (e.g. dropped without being re-created)', () => {
    const result = diffPolicyManifest([], manifest);
    expect(result.findings).toEqual([
      {
        table: 'ranked_games',
        kind: 'missing_policy',
        policyname: 'Service role can insert ranked games',
        detail: 'expected in manifest but not found live on public.ranked_games',
      },
    ]);
  });

  it('FAILS when an extra, unexpected policy appears on a pinned table', () => {
    const live: LivePolicyRow[] = [
      {
        schemaname: 'public',
        tablename: 'ranked_games',
        policyname: 'Service role can insert ranked games',
        cmd: 'INSERT',
        roles: ['service_role'],
        qual: null,
        with_check: 'true',
      },
      {
        schemaname: 'public',
        tablename: 'ranked_games',
        policyname: 'anon can insert ranked games too (surprise)',
        cmd: 'INSERT',
        roles: ['anon'],
        qual: null,
        with_check: 'true',
      },
    ];

    const result = diffPolicyManifest(live, manifest);
    expect(result.findings).toEqual([
      {
        table: 'ranked_games',
        kind: 'unexpected_policy',
        policyname: 'anon can insert ranked games too (surprise)',
        detail: expect.stringContaining('not in the manifest'),
      },
    ]);
  });

  it('reports a table with live policies but no manifest entry as unpinned, without failing the build', () => {
    const live: LivePolicyRow[] = [
      {
        schemaname: 'public',
        tablename: 'ranked_games',
        policyname: 'Service role can insert ranked games',
        cmd: 'INSERT',
        roles: ['service_role'],
        qual: null,
        with_check: 'true',
      },
      {
        schemaname: 'public',
        tablename: 'some_other_table',
        policyname: 'whatever policy',
        cmd: 'SELECT',
        roles: ['public'],
        qual: 'true',
        with_check: null,
      },
    ];

    const result = diffPolicyManifest(live, manifest);
    expect(result.findings).toEqual([]);
    expect(result.unpinnedTables).toEqual(['some_other_table']);
  });

  it('roles order does not spuriously trigger a mismatch (compared as a set, not a sequence)', () => {
    const reorderedManifest: PolicyManifest = {
      tables: {
        t: { policies: [{ policyname: 'p', cmd: 'ALL', roles: ['a', 'b'], qual: 'true', with_check: null }] },
      },
    };
    const live: LivePolicyRow[] = [
      { schemaname: 'public', tablename: 't', policyname: 'p', cmd: 'ALL', roles: ['b', 'a'], qual: 'true', with_check: null },
    ];
    expect(diffPolicyManifest(live, reorderedManifest).findings).toEqual([]);
  });
});

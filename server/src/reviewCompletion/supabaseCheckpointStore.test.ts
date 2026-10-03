import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseFetchMock = vi.fn();
vi.mock('../supabaseUtils', () => ({
  supabaseFetch: (...args: unknown[]) => supabaseFetchMock(...args),
}));

import { SupabaseCheckpointStore } from './supabaseCheckpointStore';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rcv2:u:g',
    user_id: 'u',
    game_digest: 'g',
    source_match_id: 'm',
    status: 'running',
    job_payload: { attemptCount: 99, failureReason: 'stale-payload', decisions: [] },
    claim_token: 'tok',
    claim_generation: 3,
    lease_expires_at: '2026-10-01T18:00:00.000Z',
    next_attempt_at: '2026-10-01T18:00:30.000Z',
    created_at: '2026-10-01T17:00:00.000Z',
    updated_at: '2026-10-01T17:59:00.000Z',
    completed_at: null,
    attempt_count: 2,
    failure_reason: null,
    ...overrides,
  };
}

describe('SupabaseCheckpointStore — worker isolation RPCs', () => {
  beforeEach(() => supabaseFetchMock.mockReset());

  it('claims through claim_review_completion_job_v2 with the attempt cap and backoff', async () => {
    supabaseFetchMock.mockResolvedValueOnce(row());
    const claimed = await new SupabaseCheckpointStore().claim('rcv2:u:g', 'tok', Date.now(), 60_000);
    const [path, init] = supabaseFetchMock.mock.calls[0] as [string, { body: string }];
    expect(path).toBe('/rest/v1/rpc/claim_review_completion_job_v2');
    expect(JSON.parse(init.body)).toEqual({
      p_job_id: 'rcv2:u:g',
      p_claim_token: 'tok',
      p_lease_ms: 60_000,
      p_max_attempts: 5,
      p_backoff_base_ms: 30_000,
      p_backoff_max_ms: 900_000,
    });
    // Columns are authoritative over the payload copy.
    expect(claimed?.attemptCount).toBe(2);
    expect(claimed?.failureReason).toBeNull();
    expect(claimed?.claimGeneration).toBe(3);
  });

  it('treats the all-null row the RPC returns when nothing is due as no claim', async () => {
    supabaseFetchMock.mockResolvedValueOnce({ id: null });
    expect(await new SupabaseCheckpointStore().claim('rcv2:u:g', 'tok', Date.now(), 60_000)).toBeNull();
  });

  it('renews the lease fenced on token and generation', async () => {
    supabaseFetchMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const store = new SupabaseCheckpointStore();
    expect(await store.renewLease('rcv2:u:g', 'tok', 3, 60_000)).toBe(true);
    expect(await store.renewLease('rcv2:u:g', 'tok', 2, 60_000)).toBe(false);
    const [path, init] = supabaseFetchMock.mock.calls[0] as [string, { body: string }];
    expect(path).toBe('/rest/v1/rpc/renew_review_completion_lease');
    expect(JSON.parse(init.body)).toEqual({
      p_job_id: 'rcv2:u:g', p_claim_token: 'tok', p_claim_generation: 3, p_lease_ms: 60_000,
    });
  });

  it('reads failure_reason from the column', async () => {
    supabaseFetchMock.mockResolvedValueOnce([row({ status: 'failed_fatal', failure_reason: 'pre_isolation_outage', claim_token: null })]);
    const job = await new SupabaseCheckpointStore().get('rcv2:u:g');
    expect(job?.status).toBe('failed_fatal');
    expect(job?.failureReason).toBe('pre_isolation_outage');
  });

  it('checkpoint asks only for columns back and keeps the payload it sent', async () => {
    supabaseFetchMock.mockResolvedValueOnce({
      id: 'rcv2:u:g', status: 'running', claim_token: 'tok', claim_generation: 3,
      lease_expires_at: '2026-10-01T18:01:00.000Z', next_attempt_at: '2026-10-01T18:01:00.000Z',
      updated_at: '2026-10-01T18:00:00.000Z', completed_at: null, attempt_count: 2, failure_reason: null,
    });
    const sent = {
      jobId: 'rcv2:u:g', userId: 'u', gameDigest: 'g', sourceMatchId: 'm', status: 'running',
      decisions: [{ decisionId: 'd1', lifecycle: 'SCORED' }], expectedDecisionIds: ['d1'],
      snapshots: [{ big: true }], captureFailures: [], claimToken: 'tok', claimGeneration: 3,
      nextAttemptAt: 0, leaseExpiresAt: 0, createdAt: Date.parse('2026-10-01T17:00:00.000Z'), updatedAt: 0,
    } as never;
    const saved = await new SupabaseCheckpointStore().checkpoint(sent, 'tok', 3, 60_000);
    const [path] = supabaseFetchMock.mock.calls[0] as [string];
    expect(path).toContain('/rest/v1/rpc/checkpoint_review_completion_job?select=');
    expect(path).not.toContain('job_payload');
    expect(saved?.decisions).toEqual([{ decisionId: 'd1', lifecycle: 'SCORED' }]);
    expect(saved?.claimGeneration).toBe(3);
    expect(saved?.attemptCount).toBe(2);
    expect(saved?.status).toBe('running');
  });

  it('checkpoint still reports a lost claim as null', async () => {
    supabaseFetchMock.mockResolvedValueOnce({ id: null });
    const sent = { jobId: 'j', decisions: [], snapshots: [], status: 'running', nextAttemptAt: 0, updatedAt: 0 } as never;
    expect(await new SupabaseCheckpointStore().checkpoint(sent, 'tok', 3, 60_000)).toBeNull();
  });

  it('listClaimable reads ids and lease state only', async () => {
    supabaseFetchMock.mockResolvedValueOnce([
      { id: 'j1', claim_token: null, lease_expires_at: null, next_attempt_at: '2026-10-01T18:00:00.000Z' },
    ]);
    const jobs = await new SupabaseCheckpointStore().listClaimable(Date.now(), 4);
    const [path] = supabaseFetchMock.mock.calls[0] as [string];
    expect(path).toBe('/rest/v1/rpc/list_claimable_review_completion_jobs?select=id,claim_token,lease_expires_at,next_attempt_at');
    expect(jobs).toEqual([{ jobId: 'j1', claimToken: null, leaseExpiresAt: null, nextAttemptAt: Date.parse('2026-10-01T18:00:00.000Z') }]);
  });

  it('getSummary selects the payload parts the poll needs and no snapshots', async () => {
    const { job_payload: _payload, ...columns } = row();
    supabaseFetchMock.mockResolvedValueOnce([{
      ...columns,
      decisions: [{ decisionId: 'd1', lifecycle: 'PENDING' }],
      expectedDecisionIds: ['d1'],
      accuracyModelResult: null,
      captureFailures: [],
      jobVersion: 2,
    }]);
    const job = await new SupabaseCheckpointStore().getSummary('rcv2:u:g');
    const [path] = supabaseFetchMock.mock.calls[0] as [string];
    expect(path).toContain('decisions:job_payload->decisions');
    expect(path).not.toContain('select=*');
    expect(path).not.toContain('snapshots');
    expect(job?.snapshots).toEqual([]);
    expect(job?.decisions).toEqual([{ decisionId: 'd1', lifecycle: 'PENDING' }]);
    expect(job?.expectedDecisionIds).toEqual(['d1']);
    expect(job?.attemptCount).toBe(2);
  });
});

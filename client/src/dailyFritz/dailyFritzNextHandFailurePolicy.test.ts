import { describe, expect, it } from 'vitest';
import {
  DAILY_FRITZ_STALE_CURSOR_ATTEMPTS_BEFORE_BAIL,
  DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS,
  resolveDailyFritzCompletedHandNextHandFailure,
  type DailyFritzNextHandFailureDecision,
} from './dailyFritzNextHandFailurePolicy';

describe('resolveDailyFritzCompletedHandNextHandFailure', () => {
  it('rebuilds incomplete blocked transcripts before showing Continue', () => {
    expect(resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'incomplete_transcript',
      status: 400,
      failureAttempt: 1,
    })).toEqual({ kind: 'rebuild', delayMs: 150, reason: 'rebuild-incomplete_transcript' });
  });

  it('falls back to score-only advance once transport retries are exhausted', () => {
    const decision = resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'illegal_action',
      status: 400,
      failureAttempt: DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS,
    });
    expect(decision.kind).toBe('unverified_fallback');
    if (decision.kind === 'unverified_fallback') {
      expect(decision.attempts).toBe(DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS);
    }
  });

  it('retries silently before the fallback threshold, showing nothing', () => {
    const decision = resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'illegal_action',
      status: 400,
      failureAttempt: 1,
    });
    // Previously a 'continue' decision carrying "the next deal is loading
    // automatically" — copy that promised an automatic retry the caller never
    // scheduled, so it sat next to the Retry button that did the real work.
    expect(decision.kind).toBe('retry');
    if (decision.kind === 'retry') {
      expect(decision.delayMs).toBeGreaterThan(0);
    }
    // A first failure must carry no player-facing text at all.
    expect(decision).not.toHaveProperty('message');
  });

  it('never leaves any verifier code stuck on Continue forever', () => {
    for (const verifierCode of [
      'post_terminal_action',
      'illegal_action',
      'wrong_actor',
      'incomplete_transcript',
      'fritz_action_mismatch',
      'malformed_transcript',
      null,
    ]) {
      const decision = resolveDailyFritzCompletedHandNextHandFailure({
        verifierCode,
        status: 400,
        failureAttempt: DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS + 4,
      });
      expect(decision.kind, `${verifierCode} must not strand the player`).toBe('unverified_fallback');
    }
  });

  it('rebuilds Fritz mismatch before falling back to an unranked advance', () => {
    expect(resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'fritz_action_mismatch',
      status: 409,
      failureAttempt: 1,
    }).kind).toBe('rebuild');
    expect(resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'fritz_action_mismatch',
      status: 409,
      failureAttempt: 5,
    }).kind).toBe('unverified_fallback');
  });
});

describe('resolveDailyFritzCompletedHandNextHandFailure -- stale-cursor bail (2026-09 retry-storm fix)', () => {
  it('is unaffected when serverCurrentHandIndex is not supplied -- existing callers keep their old behavior', () => {
    // Same case as "never leaves any verifier code stuck on Continue forever"
    // above, but at a much higher failureAttempt -- proves the new bail path
    // requires serverCurrentHandIndex and never fires without it.
    const decision = resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: null,
      status: 409,
      failureAttempt: 50,
    });
    expect(decision.kind).toBe('unverified_fallback');
  });

  it('is unaffected when the server cursor is only 1 hand ahead -- that is the idempotent replay window, not staleness', () => {
    const decision = resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: null,
      status: 409,
      failureAttempt: 50,
      serverCurrentHandIndex: 8,
      clientCompletedHandIndex: 7,
    });
    expect(decision.kind).toBe('unverified_fallback');
  });

  it('is unaffected by a stale cursor before the bail threshold -- still retries/falls back normally', () => {
    const belowThreshold = DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS
      + DAILY_FRITZ_STALE_CURSOR_ATTEMPTS_BEFORE_BAIL
      - 1;
    const decision = resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: null,
      status: 409,
      failureAttempt: belowThreshold,
      serverCurrentHandIndex: 10,
      clientCompletedHandIndex: 7,
    });
    expect(decision.kind).toBe('unverified_fallback');
  });

  it('bails to stale_cursor_unrecoverable once the cursor is >1 ahead and the attempt ceiling is reached', () => {
    const bailAttempt = DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS + DAILY_FRITZ_STALE_CURSOR_ATTEMPTS_BEFORE_BAIL;
    const decision = resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: null,
      status: 409,
      failureAttempt: bailAttempt,
      serverCurrentHandIndex: 10,
      clientCompletedHandIndex: 7,
    });
    expect(decision.kind).toBe('stale_cursor_unrecoverable');
    if (decision.kind === 'stale_cursor_unrecoverable') {
      expect(decision.staleByHands).toBe(3);
      expect(decision.serverCurrentHandIndex).toBe(10);
    }
  });

  it('never fires the bail for a rebuildable verifier code -- rebuild codes keep their own ladder', () => {
    const decision = resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'wrong_actor',
      status: 409,
      failureAttempt: 50,
      serverCurrentHandIndex: 10,
      clientCompletedHandIndex: 7,
    });
    expect(decision.kind).not.toBe('stale_cursor_unrecoverable');
  });

  it('simulates a real storm: server cursor 3 hands ahead of the client, asserts a bounded total request count', () => {
    // Mirrors the production incident: every attempt gets a plain 409 (no
    // verifierCode) with the SAME serverCurrentHandIndex, 3 ahead of what
    // this client keeps sending -- exactly the "never resolves via the
    // 1-behind replay window" case. Drives the real decision function in a
    // loop, the same way useHandLifecycle.ts's retry scheduler does, and
    // counts how many requests would actually be sent before the policy
    // stops scheduling more.
    const clientCompletedHandIndex = 7;
    const serverCurrentHandIndex = clientCompletedHandIndex + 3;
    let requestsSent = 1; // the request that produced the first failure
    let failureAttempt = 1;
    let decision: DailyFritzNextHandFailureDecision;
    const seenKinds: DailyFritzNextHandFailureDecision['kind'][] = [];
    // A generous upper bound purely to keep a real bug from hanging this
    // test -- the real assertion below is the actual count, not this cap.
    const SAFETY_CAP = 1000;
    for (let i = 0; i < SAFETY_CAP; i += 1) {
      decision = resolveDailyFritzCompletedHandNextHandFailure({
        verifierCode: null,
        status: 409,
        failureAttempt,
        serverCurrentHandIndex,
        clientCompletedHandIndex,
      });
      seenKinds.push(decision.kind);
      if (decision.kind === 'retry' || decision.kind === 'unverified_fallback') {
        requestsSent += 1;
        failureAttempt += 1;
        continue;
      }
      break;
    }
    expect(seenKinds[seenKinds.length - 1]).toBe('stale_cursor_unrecoverable');
    const maxExpectedRequests = DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS
      + DAILY_FRITZ_STALE_CURSOR_ATTEMPTS_BEFORE_BAIL;
    expect(requestsSent).toBe(maxExpectedRequests);
    expect(requestsSent).toBeLessThan(SAFETY_CAP);
  });
});

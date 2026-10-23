// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JOURNEY_ATTEMPT_LOG_LIMIT,
  JOURNEY_ATTEMPT_RECLAIM_AFTER_MS,
  JOURNEY_ATTEMPT_STALE_AFTER_MS,
  JOURNEY_ATTEMPTS_KEY,
  getJourneyAttemptKeyPrefix,
  getJourneyAttemptLiveness,
  getJourneyAttemptStorageKey,
  loadJourneyAttempts,
  settleJourneyAttempt,
  startJourneyAttempt,
} from './journeyAttempts';
import { setJourneyStorageUser } from './journeyStorageScope';

beforeEach(() => {
  window.localStorage.clear();
  setJourneyStorageUser(null);
});

afterEach(() => {
  setJourneyStorageUser(null);
  vi.useRealTimers();
});

describe('journey attempt lifecycle', () => {
  it('starts in progress with a stable id, node, kind, timestamp and detail', () => {
    const attempt = startJourneyAttempt({ nodeId: 'ch1-n02', kind: 'match', detail: { rival: 'Dot', winningScore: 30 } });
    expect(attempt.attemptId).toMatch(/^jat_/);
    expect(attempt).toMatchObject({ nodeId: 'ch1-n02', kind: 'match', outcome: 'in_progress', endedAt: null });
    expect(Number.isNaN(Date.parse(attempt.startedAt))).toBe(false);
    expect(attempt.detail).toEqual({ rival: 'Dot', winningScore: 30 });
    expect(loadJourneyAttempts()).toHaveLength(1);
  });

  it.each(['won', 'lost', 'abandoned'] as const)('moves in_progress to %s exactly once', (outcome) => {
    const { attemptId } = startJourneyAttempt({ nodeId: 'ch1-n02', kind: 'match' });
    const first = settleJourneyAttempt(attemptId, outcome);
    expect(first.changed).toBe(true);
    expect(first.attempt?.outcome).toBe(outcome);
    expect(first.attempt?.endedAt).not.toBeNull();
  });

  it('never rewrites a terminal attempt: a duplicate settle or a late abandon changes nothing', () => {
    const { attemptId } = startJourneyAttempt({ nodeId: 'ch1-n02', kind: 'match' });
    expect(settleJourneyAttempt(attemptId, 'won').changed).toBe(true);
    const endedAt = loadJourneyAttempts()[0].endedAt;
    // duplicate game-over callback
    expect(settleJourneyAttempt(attemptId, 'won').changed).toBe(false);
    // leaving after the result card must not turn a win into an abandonment, or into a loss
    expect(settleJourneyAttempt(attemptId, 'abandoned').changed).toBe(false);
    expect(settleJourneyAttempt(attemptId, 'lost').changed).toBe(false);
    const [only] = loadJourneyAttempts();
    expect(loadJourneyAttempts()).toHaveLength(1);
    expect(only.outcome).toBe('won');
    expect(only.endedAt).toBe(endedAt);
  });

  it('returns a null attempt for an unknown id', () => {
    expect(settleJourneyAttempt('jat_missing', 'won')).toEqual({ attempt: null, changed: false, reason: 'unknown_attempt' });
  });

  it('records two attempts for the same node as distinct attempts (rematch / replay)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
    const first = startJourneyAttempt({ nodeId: 'ch1-n02', kind: 'match' });
    settleJourneyAttempt(first.attemptId, 'lost');
    vi.setSystemTime(new Date('2026-03-01T12:05:00.000Z')); // attempts are ordered by start time (ms)
    const second = startJourneyAttempt({ nodeId: 'ch1-n02', kind: 'match' });
    expect(second.attemptId).not.toBe(first.attemptId);
    settleJourneyAttempt(second.attemptId, 'won');
    expect(loadJourneyAttempts().map((attempt) => attempt.outcome)).toEqual(['lost', 'won']);
  });

  it('merges settlement detail without dropping the start detail', () => {
    const { attemptId } = startJourneyAttempt({ nodeId: 'ch1-n02', kind: 'match', detail: { rival: 'Dot' } });
    settleJourneyAttempt(attemptId, 'won', { finalYou: 30, finalBot: 21 });
    expect(loadJourneyAttempts()[0].detail).toEqual({ rival: 'Dot', finalYou: 30, finalBot: 21 });
  });
});

describe('journey attempt persistence', () => {
  it('keeps a completed attempt across a reload', async () => {
    const { attemptId } = startJourneyAttempt({ nodeId: 'ch1-n02', kind: 'match' });
    settleJourneyAttempt(attemptId, 'won');
    vi.resetModules(); // a reload empties module memory; localStorage survives
    const reloaded = await import('./journeyAttempts');
    expect(reloaded.loadJourneyAttempts().map((attempt) => [attempt.attemptId, attempt.outcome])).toEqual([[attemptId, 'won']]);
  });

  it('turns an attempt that was still in progress at a reload into abandoned — never a win', async () => {
    const { attemptId } = startJourneyAttempt({ nodeId: 'ch1-n02', kind: 'match' });
    window.dispatchEvent(new Event('pagehide')); // the browser fires this on reload / close / navigate-away
    vi.resetModules(); // the reloaded page has no memory of the old one
    const reloaded = await import('./journeyAttempts');
    const [attempt] = reloaded.loadJourneyAttempts();
    expect(attempt.attemptId).toBe(attemptId);
    expect(attempt.outcome).toBe('abandoned');
    expect(attempt.endedAt).not.toBeNull();
    // and it stays abandoned: a late result for the dead attempt cannot resurrect it
    expect(reloaded.settleJourneyAttempt(attemptId, 'won').changed).toBe(false);
    expect(reloaded.loadJourneyAttempts()[0].outcome).toBe('abandoned');
  });

  it('a killed tab (no pagehide): stale after 3 min but NOT terminalized; only abandoned once its owner has been silent for the reclaim horizon', async () => {
    vi.useFakeTimers();
    const { attemptId } = startJourneyAttempt({ nodeId: 'ch1-n02', kind: 'match' });
    vi.resetModules(); // the tab is gone without a trace; its heartbeat stops
    const other = await import('./journeyAttempts');
    const find = () => other.loadJourneyAttempts().find((attempt) => attempt.attemptId === attemptId)!;

    vi.setSystemTime(Date.now() + JOURNEY_ATTEMPT_STALE_AFTER_MS + 1_000);
    expect(find().outcome).toBe('in_progress'); // frozen and dead look identical from outside: not terminalized
    expect(other.getJourneyAttemptLiveness(find())).toBe('stale'); // but visibly derived as stale

    vi.setSystemTime(Date.now() + JOURNEY_ATTEMPT_RECLAIM_AFTER_MS - JOURNEY_ATTEMPT_STALE_AFTER_MS - 60_000);
    expect(find().outcome).toBe('in_progress'); // still inside the reclaim horizon

    vi.setSystemTime(Date.now() + 120_000); // now past 24 h of silence
    expect(find().outcome).toBe('abandoned'); // the intended recovery path
  });

  it('does not abandon an attempt that is still live in this page', () => {
    const { attemptId } = startJourneyAttempt({ nodeId: 'ch1-n02', kind: 'match' });
    expect(loadJourneyAttempts()[0].outcome).toBe('in_progress');
    expect(settleJourneyAttempt(attemptId, 'won').changed).toBe(true);
  });

  it('ignores corrupt or malformed attempt records, and the legacy single-log key, instead of throwing', () => {
    const prefix = getJourneyAttemptKeyPrefix();
    const good = { attemptId: 'ok', nodeId: 'ch1-n02', kind: 'match', outcome: 'won', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z', detail: { a: 1, nested: { x: 1 } } };
    window.localStorage.setItem(`${prefix}corrupt`, '{not json');
    window.localStorage.setItem(`${prefix}ok`, JSON.stringify(good));
    window.localStorage.setItem(`${prefix}bad-kind`, JSON.stringify({ ...good, attemptId: 'bad-kind', kind: 'tournament' }));
    window.localStorage.setItem(`${prefix}bad-outcome`, JSON.stringify({ ...good, attemptId: 'bad-outcome', outcome: 'draw' }));
    window.localStorage.setItem(`${prefix}empty-id`, JSON.stringify({ ...good, attemptId: '' }));
    window.localStorage.setItem(`${prefix}nonsense`, JSON.stringify('nonsense'));
    // the Stage 1 single-log layout never shipped; its key must be ignored, not parsed as an attempt
    window.localStorage.setItem(`${JOURNEY_ATTEMPTS_KEY}:guest`, JSON.stringify({ version: 1, attempts: [{ ...good, attemptId: 'legacy' }] }));
    const loaded = loadJourneyAttempts();
    expect(loaded.map((attempt) => attempt.attemptId)).toEqual(['ok']);
    expect(loaded[0].detail).toEqual({ a: 1 }); // non-primitive detail values are dropped
  });

  it('enforces the lifecycle invariant on load: only in-progress attempts lack an end time or have an owner', () => {
    const prefix = getJourneyAttemptKeyPrefix();
    window.localStorage.setItem(
      `${prefix}a`,
      JSON.stringify({ attemptId: 'a', nodeId: 'n', kind: 'match', outcome: 'won', startedAt: '2026-01-01T00:00:00.000Z', endedAt: null, ownerId: 'someone', heartbeatAt: 5, detail: {} }),
    );
    const [attempt] = loadJourneyAttempts();
    expect(attempt.endedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(attempt.ownerId).toBeNull();
    expect(attempt.heartbeatAt).toBeNull();
  });

  it('stores each attempt under its own key', () => {
    const a = startJourneyAttempt({ nodeId: 'ch1-n02', kind: 'match' });
    const b = startJourneyAttempt({ nodeId: 'ch1-n04', kind: 'match' });
    expect(window.localStorage.getItem(getJourneyAttemptStorageKey(a.attemptId))).toContain(a.attemptId);
    expect(window.localStorage.getItem(getJourneyAttemptStorageKey(b.attemptId))).toContain(b.attemptId);
    expect(getJourneyAttemptStorageKey(a.attemptId)).not.toBe(getJourneyAttemptStorageKey(b.attemptId));
  });

  it('derives liveness without storing it: live (mine) / finished', () => {
    const { attemptId } = startJourneyAttempt({ nodeId: 'ch1-n02', kind: 'match' });
    expect(getJourneyAttemptLiveness(loadJourneyAttempts()[0])).toBe('live');
    settleJourneyAttempt(attemptId, 'won');
    expect(getJourneyAttemptLiveness(loadJourneyAttempts()[0])).toBe('finished');
  });

  it('caps the log by dropping the oldest finished attempts, never an in-progress one', () => {
    const open = startJourneyAttempt({ nodeId: 'ch1-n02', kind: 'match' });
    for (let index = 0; index < JOURNEY_ATTEMPT_LOG_LIMIT + 5; index += 1) {
      const { attemptId } = startJourneyAttempt({ nodeId: 'ch1-n04', kind: 'match' });
      settleJourneyAttempt(attemptId, 'lost');
    }
    const attempts = loadJourneyAttempts();
    expect(attempts.length).toBeLessThanOrEqual(JOURNEY_ATTEMPT_LOG_LIMIT);
    expect(attempts.some((attempt) => attempt.attemptId === open.attemptId && attempt.outcome === 'in_progress')).toBe(true);
  });
});

describe('journey attempt storage isolation (guest vs signed-in)', () => {
  it('uses a versioned, namespaced key, with an explicit guest namespace', () => {
    expect(getJourneyAttemptKeyPrefix()).toBe(`${JOURNEY_ATTEMPTS_KEY}:guest:a:`);
    setJourneyStorageUser('11111111-2222-3333-4444-555555555555');
    expect(getJourneyAttemptKeyPrefix()).toBe(`${JOURNEY_ATTEMPTS_KEY}:u:11111111-2222-3333-4444-555555555555:a:`);
  });

  it('never shows one namespace another namespace\'s attempts', () => {
    const guestAttempt = startJourneyAttempt({ nodeId: 'ch1-n02', kind: 'match' });
    settleJourneyAttempt(guestAttempt.attemptId, 'won');

    setJourneyStorageUser('user-a');
    expect(loadJourneyAttempts()).toEqual([]);
    const aAttempt = startJourneyAttempt({ nodeId: 'ch1-n04', kind: 'match' });
    settleJourneyAttempt(aAttempt.attemptId, 'lost');

    setJourneyStorageUser('user-b');
    expect(loadJourneyAttempts()).toEqual([]);

    setJourneyStorageUser('user-a');
    expect(loadJourneyAttempts().map((attempt) => attempt.attemptId)).toEqual([aAttempt.attemptId]);

    setJourneyStorageUser(null);
    expect(loadJourneyAttempts().map((attempt) => attempt.attemptId)).toEqual([guestAttempt.attemptId]);
  });

  it('cannot settle an attempt that belongs to a different namespace', () => {
    setJourneyStorageUser('user-a');
    const { attemptId } = startJourneyAttempt({ nodeId: 'ch1-n02', kind: 'match' });
    setJourneyStorageUser('user-b');
    expect(settleJourneyAttempt(attemptId, 'won')).toEqual({ attempt: null, changed: false, reason: 'unknown_attempt' });
    setJourneyStorageUser('user-a');
    expect(loadJourneyAttempts()[0].outcome).toBe('in_progress');
  });

  it('percent-encodes an unexpected user id instead of interpolating it raw', () => {
    setJourneyStorageUser('a/b:c d');
    expect(getJourneyAttemptKeyPrefix()).toBe(`${JOURNEY_ATTEMPTS_KEY}:u:a%2Fb%3Ac%20d:a:`);
  });

  it('does not collide a user literally named "guest" with the guest namespace', () => {
    const guest = getJourneyAttemptKeyPrefix();
    setJourneyStorageUser('guest');
    expect(getJourneyAttemptKeyPrefix()).not.toBe(guest);
  });
});

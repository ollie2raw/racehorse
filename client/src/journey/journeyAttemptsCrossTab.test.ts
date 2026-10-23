// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cross-tab behavior of the attempt log.
 *
 * A "tab" here is a separate instance of the Journey modules: its own page id, its own in-memory live
 * attempts and its own heartbeat timer — exactly what two real tabs have separately — over ONE shared
 * `localStorage`, which is exactly what they share. (`vi.resetModules()` gives each `openTab()` fresh module
 * state while the jsdom storage persists.) A test that only exercised one module instance's live set could
 * not reproduce a cross-tab defect.
 *
 * "Frozen" is simulated the way a real freeze looks to the world: the clock advances (`vi.setSystemTime`)
 * but the frozen tab's timers do not run. "Waking" runs timers again (`vi.advanceTimersByTime`).
 *
 * "Concurrent" writes are real interleavings: a hook on `Storage.setItem` lets another tab act in the middle
 * of a tab's write, i.e. after it has read its inputs and before its write lands — the window in which a
 * shared read-modify-write log loses updates.
 */

const GATE = 'ch1-n07';
const DOT = 'ch1-n02';
const MIN = 60_000;

async function openTab() {
  vi.resetModules();
  const attempts = await import('./journeyAttempts');
  const outcome = await import('./journeyMatchOutcome');
  const storage = await import('./journeyStorage');
  const launch = await import('./journeyLaunch');
  const chapters = await import('./journeyChapters');
  const scope = await import('./journeyStorageScope');
  scope.setJourneyStorageUser(null);
  const challenge = (nodeId: string) => {
    const node = chapters.getJourneyNodeById(nodeId)!;
    return launch.buildJourneyBotTrial({ ...node, status: 'unlocked' })!;
  };
  return { attempts, outcome, storage, challenge };
}

type Tab = Awaited<ReturnType<typeof openTab>>;
const stateOf = (tab: Tab, attemptId: string) => tab.attempts.loadJourneyAttempts().find((attempt) => attempt.attemptId === attemptId)?.outcome;
const completed = (tab: Tab, nodeId: string) => tab.storage.loadJourneyProgress().chapters['ch1-fritz-trail'].completedNodeIds.includes(nodeId);
const completions = (tab: Tab, nodeId: string) => tab.storage.loadJourneyProgress().chapters['ch1-fritz-trail'].completedNodeIds.filter((id) => id === nodeId).length;

/**
 * Replaces `window.localStorage` with a thin wrapper that delegates to the real storage and lets a test run
 * code around writes. (Spying on the storage prototype is not reliable across jsdom and Node's own
 * `localStorage`, and assigning a method onto a Storage would create a *stored item*; a wrapper is both.)
 * Every module "tab" reads `window.localStorage` on each call, so they all see the hooked storage.
 */
function hookStorageWrites(onWrite: (key: string, value: string, write: () => void) => void): () => void {
  const real = window.localStorage;
  const own = Object.getOwnPropertyDescriptor(window, 'localStorage');
  const wrapper = {
    get length() { return real.length; },
    key: (index: number) => real.key(index),
    getItem: (key: string) => real.getItem(key),
    removeItem: (key: string) => real.removeItem(key),
    clear: () => real.clear(),
    setItem: (key: string, value: string) => onWrite(key, value, () => real.setItem(key, value)),
  } as unknown as Storage;
  Object.defineProperty(window, 'localStorage', { configurable: true, value: wrapper });
  return () => {
    if (own) Object.defineProperty(window, 'localStorage', own);
    else delete (window as unknown as Record<string, unknown>).localStorage;
  };
}

/** Runs `action` once, in the middle of the next attempt-record write (after it started, before it lands). */
function interleaveOnNextAttemptWrite(action: () => void): () => void {
  let armed = true;
  return hookStorageWrites((key, _value, write) => {
    if (armed && key.includes(':a:')) {
      armed = false;
      action();
    }
    write();
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the reviewed sequence: tab B must not take tab A\'s live attempt', () => {
  it('A starts a match; B opens Journey and starts its own attempt; A\'s stays in progress; A wins once, recorded exactly once', async () => {
    const tabA = await openTab();
    tabA.storage.markJourneyNodeCompleted(GATE);
    const challengeA = tabA.outcome.beginJourneyMatchAttempt(tabA.challenge(DOT));

    const tabB = await openTab();
    expect(tabB.outcome.abandonStaleJourneyMatchAttempts()).toBe(0);
    const lessonB = tabB.attempts.startJourneyAttempt({ nodeId: GATE, kind: 'lesson' });

    expect(stateOf(tabB, challengeA.attemptId!)).toBe('in_progress');
    expect(stateOf(tabB, lessonB.attemptId)).toBe('in_progress');

    expect(tabA.outcome.recordJourneyMatchOutcome({ attemptId: challengeA.attemptId!, nodeId: DOT, won: true })).toEqual({ recorded: true, completedNode: true });
    expect(tabA.outcome.recordJourneyMatchOutcome({ attemptId: challengeA.attemptId!, nodeId: DOT, won: true })).toMatchObject({ recorded: false, refused: 'already_terminal' });

    const final = tabB.attempts.loadJourneyAttempts();
    expect(final.filter((attempt) => attempt.outcome === 'won')).toHaveLength(1);
    expect(stateOf(tabB, lessonB.attemptId)).toBe('in_progress');
    expect(completions(tabB, DOT)).toBe(1);
  });

  it('B opening the trail abandons only attempts B itself owns, never A\'s', async () => {
    const tabA = await openTab();
    const a = tabA.outcome.beginJourneyMatchAttempt(tabA.challenge(DOT));
    const tabB = await openTab();
    const b = tabB.outcome.beginJourneyMatchAttempt(tabB.challenge(DOT));
    expect(tabB.outcome.abandonStaleJourneyMatchAttempts()).toBe(1);
    expect(stateOf(tabA, b.attemptId!)).toBe('abandoned');
    expect(stateOf(tabA, a.attemptId!)).toBe('in_progress');
  });

  it('a tab cannot settle another tab\'s live attempt, and the owner still can afterwards', async () => {
    const tabA = await openTab();
    const a = tabA.attempts.startJourneyAttempt({ nodeId: DOT, kind: 'match' });
    const tabB = await openTab();
    expect(tabB.attempts.settleJourneyAttempt(a.attemptId, 'won')).toMatchObject({ changed: false, reason: 'owned_elsewhere' });
    expect(tabB.attempts.settleJourneyAttempt(a.attemptId, 'abandoned')).toMatchObject({ changed: false, reason: 'owned_elsewhere' });
    expect(tabA.attempts.settleJourneyAttempt(a.attemptId, 'won')).toMatchObject({ changed: true });
  });
});

describe('a live owner whose heartbeat goes stale (frozen or throttled, not dead)', () => {
  it('is derived as stale but NOT terminalized by another tab, and its legitimate late win is recorded', async () => {
    const tabA = await openTab();
    tabA.storage.markJourneyNodeCompleted(GATE);
    const challenge = tabA.outcome.beginJourneyMatchAttempt(tabA.challenge(DOT));
    const tabB = await openTab();

    vi.setSystemTime(Date.now() + 10 * MIN); // A is frozen for 10 minutes: far past the 3-minute stale mark; no timers run
    const seenByB = tabB.attempts.loadJourneyAttempts().find((attempt) => attempt.attemptId === challenge.attemptId)!;
    expect(seenByB.outcome).toBe('in_progress'); // not abandoned
    expect(tabB.attempts.getJourneyAttemptLiveness(seenByB)).toBe('stale'); // but visibly stale

    // A wakes and finishes the match it never stopped playing. The win is accepted.
    expect(tabA.outcome.recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true })).toEqual({ recorded: true, completedNode: true });
    expect(stateOf(tabB, challenge.attemptId!)).toBe('won');
    expect(completions(tabB, DOT)).toBe(1);
  });

  it('wakes, beats, and is fresh again — with no state change having happened in between', async () => {
    const tabA = await openTab();
    const a = tabA.attempts.startJourneyAttempt({ nodeId: DOT, kind: 'match' });
    const tabB = await openTab();
    vi.setSystemTime(Date.now() + 10 * MIN);
    expect(tabB.attempts.getJourneyAttemptLiveness(tabB.attempts.loadJourneyAttempts()[0])).toBe('stale');

    vi.advanceTimersByTime(tabA.attempts.JOURNEY_ATTEMPT_HEARTBEAT_MS); // A's timer runs again
    expect(tabB.attempts.getJourneyAttemptLiveness(tabB.attempts.loadJourneyAttempts()[0])).toBe('active');
    expect(stateOf(tabB, a.attemptId)).toBe('in_progress');
  });

  it('a second tab starting another attempt while the first is stale: neither blocks nor disturbs the other, and both can finish', async () => {
    const tabA = await openTab();
    tabA.storage.markJourneyNodeCompleted(GATE);
    const first = tabA.outcome.beginJourneyMatchAttempt(tabA.challenge(DOT));
    const tabB = await openTab();
    vi.setSystemTime(Date.now() + 10 * MIN); // A frozen: stale

    const second = tabB.outcome.beginJourneyMatchAttempt(tabB.challenge(DOT)); // not blocked by A's stale attempt
    tabB.outcome.abandonStaleJourneyMatchAttempts(); // B's own trail sweep (B's own attempt only)
    expect(stateOf(tabB, first.attemptId!)).toBe('in_progress'); // A's untouched by B starting and sweeping
    expect(stateOf(tabB, second.attemptId!)).toBe('abandoned'); // B's own, swept because B is "back on its trail"

    const third = tabB.outcome.beginJourneyMatchAttempt(tabB.challenge(DOT)); // B plays on, still unblocked
    expect(stateOf(tabB, third.attemptId!)).toBe('in_progress');

    // A wakes and wins; B then wins its own match. Both are legitimate, each recorded once; the stage completes once.
    expect(tabA.outcome.recordJourneyMatchOutcome({ attemptId: first.attemptId!, nodeId: DOT, won: true })).toEqual({ recorded: true, completedNode: true });
    expect(tabB.outcome.recordJourneyMatchOutcome({ attemptId: third.attemptId!, nodeId: DOT, won: true })).toEqual({ recorded: true, completedNode: false });
    expect(tabB.attempts.loadJourneyAttempts().filter((attempt) => attempt.outcome === 'won')).toHaveLength(2);
    expect(completions(tabB, DOT)).toBe(1);
  });
});

describe('a delayed heartbeat never overwrites a terminal result or a newer owner', () => {
  it('a frozen tab reclaimed after the 24 h horizon wakes and beats: the abandonment stands, nothing is overwritten, its late win is refused and reported', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tabA = await openTab();
    tabA.storage.markJourneyNodeCompleted(GATE);
    const challenge = tabA.outcome.beginJourneyMatchAttempt(tabA.challenge(DOT));
    const tabB = await openTab();

    vi.setSystemTime(Date.now() + tabB.attempts.JOURNEY_ATTEMPT_RECLAIM_AFTER_MS + MIN); // A silent for over a day
    expect(stateOf(tabB, challenge.attemptId!)).toBe('abandoned'); // reclaimed: the owner is treated as gone
    const before = window.localStorage.getItem(tabA.attempts.getJourneyAttemptStorageKey(challenge.attemptId!));

    vi.advanceTimersByTime(tabA.attempts.JOURNEY_ATTEMPT_HEARTBEAT_MS); // A's delayed heartbeat finally fires
    expect(window.localStorage.getItem(tabA.attempts.getJourneyAttemptStorageKey(challenge.attemptId!))).toBe(before); // untouched
    expect(stateOf(tabA, challenge.attemptId!)).toBe('abandoned');

    // The documented trade-off: a result arriving after a 24 h reclaim is refused — loudly, never overwriting.
    expect(tabA.outcome.recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true })).toMatchObject({ recorded: false, refused: 'already_terminal' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('was not recorded'));
    expect(completed(tabA, DOT)).toBe(false);
  });

  it('a heartbeat firing after the owner settled (win) leaves the result exactly as it is', async () => {
    const tabA = await openTab();
    tabA.storage.markJourneyNodeCompleted(GATE);
    const challenge = tabA.outcome.beginJourneyMatchAttempt(tabA.challenge(DOT));
    tabA.outcome.recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true });
    const key = tabA.attempts.getJourneyAttemptStorageKey(challenge.attemptId!);
    const settled = window.localStorage.getItem(key);

    vi.advanceTimersByTime(tabA.attempts.JOURNEY_ATTEMPT_HEARTBEAT_MS * 4);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(window.localStorage.getItem(key)).toBe(settled);
    expect(vi.getTimerCount()).toBe(0); // and the heartbeat stopped when nothing was live
  });

  it('a heartbeat never overwrites a record another page has since taken over', async () => {
    const tabA = await openTab();
    const a = tabA.attempts.startJourneyAttempt({ nodeId: DOT, kind: 'match' });
    const key = tabA.attempts.getJourneyAttemptStorageKey(a.attemptId);
    const takenOver = { ...JSON.parse(window.localStorage.getItem(key)!), ownerId: 'jpg_someone_else', heartbeatAt: Date.now() };
    window.localStorage.setItem(key, JSON.stringify(takenOver));

    vi.advanceTimersByTime(tabA.attempts.JOURNEY_ATTEMPT_HEARTBEAT_MS);
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual(takenOver); // not overwritten
  });
});

describe('concurrent activity on distinct attempts never loses a record', () => {
  it('B starts an attempt in the middle of A starting one: both survive', async () => {
    const tabA = await openTab();
    const tabB = await openTab();
    let b!: { attemptId: string };
    const restore = interleaveOnNextAttemptWrite(() => { b = tabB.attempts.startJourneyAttempt({ nodeId: GATE, kind: 'lesson' }); });
    const a = tabA.attempts.startJourneyAttempt({ nodeId: DOT, kind: 'match' });
    restore();

    const ids = tabA.attempts.loadJourneyAttempts().map((attempt) => attempt.attemptId).sort();
    expect(ids).toEqual([a.attemptId, b.attemptId].sort());
  });

  it('B starts an attempt in the middle of A settling a win: the win is recorded and B\'s attempt exists', async () => {
    const tabA = await openTab();
    tabA.storage.markJourneyNodeCompleted(GATE);
    const challenge = tabA.outcome.beginJourneyMatchAttempt(tabA.challenge(DOT));
    const tabB = await openTab();
    let b!: { attemptId: string };
    const restore = interleaveOnNextAttemptWrite(() => { b = tabB.attempts.startJourneyAttempt({ nodeId: GATE, kind: 'lesson' }); });
    tabA.outcome.recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true });
    restore();

    expect(stateOf(tabB, challenge.attemptId!)).toBe('won');
    expect(stateOf(tabB, b.attemptId)).toBe('in_progress');
    expect(completions(tabB, DOT)).toBe(1);
  });

  it('A\'s heartbeat landing in the middle of B starting an attempt neither drops B\'s attempt nor reverts anything', async () => {
    const tabA = await openTab();
    const a = tabA.attempts.startJourneyAttempt({ nodeId: DOT, kind: 'match' });
    const tabB = await openTab();
    const restore = interleaveOnNextAttemptWrite(() => vi.advanceTimersByTime(tabA.attempts.JOURNEY_ATTEMPT_HEARTBEAT_MS));
    const b = tabB.attempts.startJourneyAttempt({ nodeId: GATE, kind: 'lesson' });
    restore();

    expect(stateOf(tabA, a.attemptId)).toBe('in_progress');
    expect(stateOf(tabA, b.attemptId)).toBe('in_progress');
  });

  it('two tabs starting and settling many attempts in alternation lose none', async () => {
    const tabA = await openTab();
    const tabB = await openTab();
    const ids: string[] = [];
    for (let round = 0; round < 25; round += 1) {
      const a = tabA.attempts.startJourneyAttempt({ nodeId: DOT, kind: 'match' });
      const b = tabB.attempts.startJourneyAttempt({ nodeId: GATE, kind: 'lesson' });
      tabA.attempts.settleJourneyAttempt(a.attemptId, 'lost');
      tabB.attempts.settleJourneyAttempt(b.attemptId, 'won');
      ids.push(a.attemptId, b.attemptId);
    }
    const stored = tabA.attempts.loadJourneyAttempts();
    expect(stored.map((attempt) => attempt.attemptId).sort()).toEqual(ids.slice().sort());
    expect(stored.filter((attempt) => attempt.outcome === 'lost')).toHaveLength(25);
    expect(stored.filter((attempt) => attempt.outcome === 'won')).toHaveLength(25);
  });

  it('a record that does disappear (storage cleared) is restored by its owner: on settle, and on the next heartbeat', async () => {
    const tabA = await openTab();
    tabA.storage.markJourneyNodeCompleted(GATE);
    const challenge = tabA.outcome.beginJourneyMatchAttempt(tabA.challenge(DOT));
    const key = tabA.attempts.getJourneyAttemptStorageKey(challenge.attemptId!);

    window.localStorage.removeItem(key);
    vi.advanceTimersByTime(tabA.attempts.JOURNEY_ATTEMPT_HEARTBEAT_MS + 1); // heartbeat re-adds it
    const tabB = await openTab();
    expect(stateOf(tabB, challenge.attemptId!)).toBe('in_progress');

    window.localStorage.removeItem(key);
    expect(tabA.outcome.recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true })).toEqual({ recorded: true, completedNode: true }); // restored, settled
    expect(stateOf(tabB, challenge.attemptId!)).toBe('won');
  });
});

describe('progress completion survives another tab\'s concurrent progress write', () => {
  it('a completion overwritten by a stale write from another tab is re-applied and sticks, once', async () => {
    const tabA = await openTab();
    tabA.storage.markJourneyNodeCompleted(GATE);
    const challenge = tabA.outcome.beginJourneyMatchAttempt(tabA.challenge(DOT));
    const progressKey = tabA.storage.getJourneyProgressStorageKey();
    const staleSnapshot = window.localStorage.getItem(progressKey)!; // what another tab read before A's win

    let clobbers = 0;
    const real = window.localStorage;
    const restoreClobber = hookStorageWrites((key, _value, write) => {
      write();
      if (key === progressKey && clobbers < 1) {
        clobbers += 1;
        real.setItem(key, staleSnapshot); // the other tab's late write lands on top of A's
      }
    });
    expect(tabA.outcome.recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true })).toEqual({ recorded: true, completedNode: true });
    restoreClobber();

    expect(clobbers).toBe(1);
    expect(completed(tabA, DOT)).toBe(true);
    expect(completions(tabA, DOT)).toBe(1);
  });

  it('if another tab keeps overwriting it, the gap is reported instead of hidden', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tabA = await openTab();
    tabA.storage.markJourneyNodeCompleted(GATE);
    const challenge = tabA.outcome.beginJourneyMatchAttempt(tabA.challenge(DOT));
    const progressKey = tabA.storage.getJourneyProgressStorageKey();
    const staleSnapshot = window.localStorage.getItem(progressKey)!;
    const real = window.localStorage;
    const restore = hookStorageWrites((key, _value, write) => {
      if (key === progressKey) real.setItem(key, staleSnapshot); // every progress write is lost
      else write();
    });
    tabA.outcome.recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true });
    restore();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not be verified'));
    expect(tabA.attempts.loadJourneyAttempts().find((attempt) => attempt.attemptId === challenge.attemptId)?.outcome).toBe('won'); // the win itself is on record
  });
});

describe('genuinely abandoned or crashed attempts stay recoverable', () => {
  it('a page being destroyed (pagehide, not bfcache) records its own attempts as abandoned immediately — the owner knows', async () => {
    const tabA = await openTab();
    const a = tabA.attempts.startJourneyAttempt({ nodeId: DOT, kind: 'match' });
    window.dispatchEvent(new Event('pagehide')); // reload / close: persisted is not true
    const tabB = await openTab();
    expect(stateOf(tabB, a.attemptId)).toBe('abandoned');
  });

  it('a page entering the back/forward cache writes nothing; restoring it beats and carries on', async () => {
    const tabA = await openTab();
    const a = tabA.attempts.startJourneyAttempt({ nodeId: DOT, kind: 'match' });
    window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
    expect(stateOf(tabA, a.attemptId)).toBe('in_progress');
    vi.setSystemTime(Date.now() + 10 * MIN);
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(tabA.attempts.getJourneyAttemptLiveness(tabA.attempts.loadJourneyAttempts()[0])).toBe('live');
    expect(tabA.attempts.settleJourneyAttempt(a.attemptId, 'won')).toMatchObject({ changed: true });
  });

  it('a killed tab (no pagehide) is stale at once, still recoverable by its owner for a day, and cleaned up by any tab after that', async () => {
    const dead = await openTab();
    const a = dead.attempts.startJourneyAttempt({ nodeId: DOT, kind: 'match' });
    const survivor = await openTab();

    vi.setSystemTime(Date.now() + 5 * MIN);
    expect(stateOf(survivor, a.attemptId)).toBe('in_progress');
    vi.setSystemTime(Date.now() + survivor.attempts.JOURNEY_ATTEMPT_RECLAIM_AFTER_MS);
    expect(stateOf(survivor, a.attemptId)).toBe('abandoned'); // the intended cleanup path
    expect(survivor.attempts.loadJourneyAttempts().find((attempt) => attempt.attemptId === a.attemptId)).toMatchObject({ ownerId: null, heartbeatAt: null });
  });

  it('a stale attempt never blocks starting a new one: starting reads and writes only its own record', async () => {
    const dead = await openTab();
    dead.attempts.startJourneyAttempt({ nodeId: DOT, kind: 'match' });
    const survivor = await openTab();
    vi.setSystemTime(Date.now() + 10 * MIN);
    const fresh = survivor.attempts.startJourneyAttempt({ nodeId: DOT, kind: 'match' });
    expect(stateOf(survivor, fresh.attemptId)).toBe('in_progress');
    expect(survivor.attempts.loadJourneyAttempts()).toHaveLength(2);
  });
});

describe('terminal immutability and duplicates (unchanged guarantees)', () => {
  it('a terminal result is never rewritten, by a duplicate callback, a late abandon, a reclaim sweep, or a heartbeat', async () => {
    const tabA = await openTab();
    tabA.storage.markJourneyNodeCompleted(GATE);
    const challenge = tabA.outcome.beginJourneyMatchAttempt(tabA.challenge(DOT));
    tabA.outcome.recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true });
    const key = tabA.attempts.getJourneyAttemptStorageKey(challenge.attemptId!);
    const settled = window.localStorage.getItem(key);

    const tabB = await openTab();
    tabA.outcome.recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true });
    tabA.attempts.settleJourneyAttempt(challenge.attemptId!, 'abandoned');
    tabA.attempts.settleJourneyAttempt(challenge.attemptId!, 'lost');
    vi.setSystemTime(Date.now() + tabB.attempts.JOURNEY_ATTEMPT_RECLAIM_AFTER_MS * 2);
    tabB.attempts.loadJourneyAttempts();
    vi.advanceTimersByTime(tabA.attempts.JOURNEY_ATTEMPT_HEARTBEAT_MS * 3);
    expect(window.localStorage.getItem(key)).toBe(settled);
    expect(completions(tabB, DOT)).toBe(1);
  });

  it('the heartbeat timestamp actually advances while the owner lives, and the timer stops when nothing is live', async () => {
    const tabA = await openTab();
    const a = tabA.attempts.startJourneyAttempt({ nodeId: DOT, kind: 'match' });
    const startedBeat = tabA.attempts.loadJourneyAttempts()[0].heartbeatAt!;
    vi.advanceTimersByTime(tabA.attempts.JOURNEY_ATTEMPT_HEARTBEAT_MS + 1);
    expect(tabA.attempts.loadJourneyAttempts()[0].heartbeatAt!).toBeGreaterThan(startedBeat);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    tabA.attempts.settleJourneyAttempt(a.attemptId, 'lost');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settling an attempt from another account\'s namespace is refused (no cross-namespace writes)', async () => {
    const tabA = await openTab();
    const a = tabA.attempts.startJourneyAttempt({ nodeId: DOT, kind: 'match' });
    const scope = await import('./journeyStorageScope');
    scope.setJourneyStorageUser('someone-else');
    expect(tabA.attempts.settleJourneyAttempt(a.attemptId, 'won')).toMatchObject({ changed: false });
  });
});

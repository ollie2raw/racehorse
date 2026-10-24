// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A recorded Journey match win must not stay disconnected from the progress the player sees.
 *
 * WHAT IS SIMULATED (and what is not)
 *   - "Crash between settle and progress": the real steps 1–2 run (pending record written, attempt settled
 *     `won`) and step 3 never does; the page is then "reloaded" with `vi.resetModules()` (fresh module state,
 *     shared `localStorage`).
 *   - "Lost race": a wrapper around `window.localStorage` lets another tab's progress write land right after
 *     this tab's — a real stale read-modify-write from a second module instance (its own page id and state),
 *     i.e. exactly what overwrites a completion. Not simulated: true parallel threads (JS tests are serial), so
 *     the interleaving is forced rather than raced.
 *   - The recovery entry point exercised is the one the trail uses: mounting `useJourneyProgress`.
 */

const GATE = 'ch1-n07';
const DOT = 'ch1-n02';
const BOSS = 'ch1-n10';

async function openTab() {
  vi.resetModules();
  const attempts = await import('./journeyAttempts');
  const outcome = await import('./journeyMatchOutcome');
  const recovery = await import('./journeyCompletionRecovery');
  const storage = await import('./journeyStorage');
  const pending = await import('./journeyPendingCompletions');
  const launch = await import('./journeyLaunch');
  const chapters = await import('./journeyChapters');
  const scope = await import('./journeyStorageScope');
  const rtl = await import('@testing-library/react'); // same React instance as the hook below
  const hook = await import('./useJourneyProgress');
  scope.setJourneyStorageUser(null);
  const challenge = (nodeId: string) => launch.buildJourneyBotTrial({ ...chapters.getJourneyNodeById(nodeId)!, status: 'unlocked' })!;
  /** Mount the trail's progress hook — the real Journey-load recovery entry point — and return its progress. */
  const mountTrail = () => rtl.renderHook(() => hook.useJourneyProgress()).result.current;
  return { attempts, outcome, recovery, storage, pending, challenge, mountTrail };
}
type Tab = Awaited<ReturnType<typeof openTab>>;

const chapterOne = (tab: Tab) => tab.storage.loadJourneyProgress().chapters['ch1-fritz-trail'];
const completedIds = (tab: Tab) => chapterOne(tab).completedNodeIds;
const statusOf = (tab: Tab, id: string, nodes = tab.mountTrail().nodesWithStatus) => nodes.find((node) => node.id === id)?.status;
const pendingFor = (tab: Tab) => tab.pending.listPendingCompletions();

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

/** The attempt-log record a Journey launch would have written, for building valid and invalid fixtures. */
function wonAttemptRecord(over: Record<string, unknown> = {}, detail: Record<string, unknown> = {}) {
  return {
    attemptId: 'jat_fixture', nodeId: DOT, kind: 'match', outcome: 'won',
    startedAt: '2026-03-01T12:00:00.000Z', endedAt: '2026-03-01T12:10:00.000Z', ownerId: null, heartbeatAt: null,
    detail: { stage: 'Dot’s Table', rival: 'Dot', fritzTier: 'rookie', dealSize: 7, winningScore: 30, chapterLayout: 2, ...detail },
    ...over,
  };
}
function seedAttempt(tab: Tab, record: Record<string, unknown>) {
  window.localStorage.setItem(tab.attempts.getJourneyAttemptStorageKey(String(record.attemptId)), JSON.stringify(record));
}
function seedPending(tab: Tab, attemptId: string, nodeId: string) {
  expect(tab.pending.registerPendingCompletion(attemptId, nodeId)).toBe(true);
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('a legitimate win settles and completes the right stage', () => {
  it('marks only the won stage complete, settles the attempt, and leaves no obligation behind', async () => {
    const tab = await openTab();
    tab.storage.markJourneyNodeCompleted(GATE);
    const challenge = tab.outcome.beginJourneyMatchAttempt(tab.challenge(DOT));
    expect(tab.outcome.recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true })).toEqual({ recorded: true, completedNode: true });
    expect(completedIds(tab)).toEqual([GATE, DOT]);
    expect(tab.attempts.loadJourneyAttempts()[0].outcome).toBe('won');
    expect(pendingFor(tab)).toEqual([]); // cleared only after the stage was verified complete
  });

  it('registers the obligation BEFORE settling: it is already durable when the attempt turns won', async () => {
    const tab = await openTab();
    tab.storage.markJourneyNodeCompleted(GATE);
    const challenge = tab.outcome.beginJourneyMatchAttempt(tab.challenge(DOT));
    const order: string[] = [];
    const restore = hookStorageWrites((key, _value, write) => {
      if (key.startsWith('rh_journey_pending_completion_v1')) order.push('pending');
      else if (key.includes(':a:')) order.push('attempt');
      else if (key.startsWith('rh_journey_progress_v1')) order.push('progress');
      write();
    });
    tab.outcome.recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true });
    restore();
    expect(order).toEqual(['pending', 'attempt', 'progress']); // owed -> settled -> completed; never completed before settled
  });

  it('a failed settlement never leaves a completed stage', async () => {
    const tab = await openTab();
    tab.storage.markJourneyNodeCompleted(GATE);
    const challenge = tab.outcome.beginJourneyMatchAttempt(tab.challenge(DOT));
    tab.attempts.settleJourneyAttempt(challenge.attemptId!, 'abandoned'); // the attempt is already terminal
    expect(tab.outcome.recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true })).toMatchObject({ recorded: false, completedNode: false });
    expect(completedIds(tab)).toEqual([GATE]);
    expect(pendingFor(tab)).toEqual([]); // and no obligation was left behind by the refused settlement
  });
});

describe('a progress write that loses a race is eventually repaired', () => {
  it('a couple of lost writes are repaired inside the same run', async () => {
    const tab = await openTab();
    tab.storage.markJourneyNodeCompleted(GATE);
    const challenge = tab.outcome.beginJourneyMatchAttempt(tab.challenge(DOT));
    const progressKey = tab.storage.getJourneyProgressStorageKey();
    const stale = window.localStorage.getItem(progressKey)!;
    const real = window.localStorage;
    let lost = 0;
    const restore = hookStorageWrites((key, _value, write) => {
      write();
      if (key === progressKey && lost < 2) { lost += 1; real.setItem(key, stale); } // another tab's stale write lands on top
    });
    expect(tab.outcome.recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true })).toEqual({ recorded: true, completedNode: true });
    restore();
    expect(lost).toBe(2);
    expect(completedIds(tab)).toEqual([GATE, DOT]);
    expect(pendingFor(tab)).toEqual([]);
  });

  it('when every in-run retry is lost, the win stays on record with a durable obligation — and the next Journey load completes the stage', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tab = await openTab();
    tab.storage.markJourneyNodeCompleted(GATE);
    const challenge = tab.outcome.beginJourneyMatchAttempt(tab.challenge(DOT));
    const progressKey = tab.storage.getJourneyProgressStorageKey();
    const stale = window.localStorage.getItem(progressKey)!;
    const real = window.localStorage;
    const restore = hookStorageWrites((key, _value, write) => {
      if (key === progressKey) real.setItem(key, stale); // sustained contention: every progress write is overwritten
      else write();
    });
    const result = tab.outcome.recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true });
    restore();

    expect(result).toEqual({ recorded: true, completedNode: false, completionPending: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('will be retried on the next Journey load'));
    expect(tab.attempts.loadJourneyAttempts()[0].outcome).toBe('won'); // the win is durable
    expect(completedIds(tab)).toEqual([GATE]); // the stage is not (yet)
    expect(pendingFor(tab)).toHaveLength(1); // ...and the obligation is

    // Contention has stopped. The next Journey load — mounting the trail — finishes the job, before display.
    const trail = tab.mountTrail();
    expect(trail.nodesWithStatus.find((node) => node.id === DOT)?.status).toBe('completed');
    expect(completedIds(tab)).toEqual([GATE, DOT]);
    expect(pendingFor(tab)).toEqual([]);
  });
});

describe('crash windows, then a reload', () => {
  it('reload after the attempt is `won` but before progress completion: the next Journey load repairs the stage', async () => {
    const before = await openTab();
    before.storage.markJourneyNodeCompleted(GATE);
    const challenge = before.outcome.beginJourneyMatchAttempt(before.challenge(DOT));
    // Steps 1 and 2 happened for real; the page died before step 3.
    expect(before.pending.registerPendingCompletion(challenge.attemptId!, DOT)).toBe(true);
    expect(before.attempts.settleJourneyAttempt(challenge.attemptId!, 'won').changed).toBe(true);
    expect(completedIds(before)).toEqual([GATE]); // progress never got the completion

    const after = await openTab(); // the reload: fresh module state, shared storage
    expect(after.attempts.loadJourneyAttempts()[0].outcome).toBe('won');
    expect(statusOf(after, DOT)).toBe('completed'); // repaired by mounting the trail (the real entry point)
    expect(completedIds(after)).toEqual([GATE, DOT]);
    expect(pendingFor(after)).toEqual([]);
  });

  it('crash between registering the obligation and settling: nothing is granted, and the dead obligation is cleaned up', async () => {
    const before = await openTab();
    before.storage.markJourneyNodeCompleted(GATE);
    const challenge = before.outcome.beginJourneyMatchAttempt(before.challenge(DOT));
    expect(before.pending.registerPendingCompletion(challenge.attemptId!, DOT)).toBe(true);
    window.dispatchEvent(new Event('pagehide')); // the page is destroyed: the owner abandons its attempt

    const after = await openTab();
    expect(statusOf(after, DOT)).not.toBe('completed');
    expect(completedIds(after)).toEqual([GATE]);
    expect(after.attempts.loadJourneyAttempts()[0].outcome).toBe('abandoned');
    expect(pendingFor(after)).toEqual([]); // the record pointed at a non-win: removed, never honored
  });

  it('an obligation whose attempt is still in flight is left alone (another tab may be mid-settlement)', async () => {
    const tabA = await openTab();
    tabA.storage.markJourneyNodeCompleted(GATE);
    const challenge = tabA.outcome.beginJourneyMatchAttempt(tabA.challenge(DOT));
    tabA.pending.registerPendingCompletion(challenge.attemptId!, DOT);
    const tabB = await openTab();
    expect(tabB.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 0, pending: 1 });
    expect(completedIds(tabB)).toEqual([GATE]);
    expect(pendingFor(tabB)).toHaveLength(1);
  });
});

describe('repeated recovery is idempotent', () => {
  it('re-running recovery changes nothing: no duplicate completion, no rewrite, no stray records', async () => {
    const before = await openTab();
    before.storage.markJourneyNodeCompleted(GATE);
    const challenge = before.outcome.beginJourneyMatchAttempt(before.challenge(DOT));
    before.pending.registerPendingCompletion(challenge.attemptId!, DOT);
    before.attempts.settleJourneyAttempt(challenge.attemptId!, 'won');

    const tab = await openTab();
    expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 });
    const progressKey = tab.storage.getJourneyProgressStorageKey();
    const afterFirst = window.localStorage.getItem(progressKey);
    for (let run = 0; run < 5; run += 1) {
      expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 0, pending: 0 });
      tab.mountTrail();
    }
    expect(window.localStorage.getItem(progressKey)).toBe(afterFirst); // not even rewritten
    expect(completedIds(tab)).toEqual([GATE, DOT]);
    expect(pendingFor(tab)).toEqual([]);
  });

  it('two tabs recovering the same obligation both end with one completion', async () => {
    const before = await openTab();
    before.storage.markJourneyNodeCompleted(GATE);
    const challenge = before.outcome.beginJourneyMatchAttempt(before.challenge(DOT));
    before.pending.registerPendingCompletion(challenge.attemptId!, DOT);
    before.attempts.settleJourneyAttempt(challenge.attemptId!, 'won');
    const tabA = await openTab();
    const tabB = await openTab();
    tabA.recovery.recoverPendingJourneyCompletions();
    tabB.recovery.recoverPendingJourneyCompletions();
    expect(completedIds(tabB).filter((id) => id === DOT)).toHaveLength(1);
    expect(pendingFor(tabB)).toEqual([]);
  });

  it('a progress reset after recovery is not undone by later loads (no resurrection from history)', async () => {
    const before = await openTab();
    before.storage.markJourneyNodeCompleted(GATE);
    const challenge = before.outcome.beginJourneyMatchAttempt(before.challenge(DOT));
    expect(before.outcome.recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true }).completedNode).toBe(true);
    before.storage.resetJourneyProgress();
    const tab = await openTab();
    tab.mountTrail();
    expect(completedIds(tab)).toEqual([]); // a won attempt in the log is history, not an obligation
  });
});

describe('what never grants completion', () => {
  async function recoverWith(setup: (tab: Tab) => void) {
    const tab = await openTab();
    tab.storage.markJourneyNodeCompleted(GATE);
    setup(tab);
    const result = tab.recovery.recoverPendingJourneyCompletions();
    return { tab, result };
  }

  it('a won attempt with NO obligation record (an arbitrary log entry) completes nothing', async () => {
    const { tab, result } = await recoverWith((t) => seedAttempt(t, wonAttemptRecord()));
    expect(result).toEqual({ applied: 0, cleared: 0, pending: 0 });
    expect(completedIds(tab)).toEqual([GATE]);
    expect(statusOf(tab, DOT)).toBe('current');
  });

  it('a loss, even with an obligation record, completes nothing and the record is removed', async () => {
    const { tab, result } = await recoverWith((t) => { seedAttempt(t, wonAttemptRecord({ outcome: 'lost' })); seedPending(t, 'jat_fixture', DOT); });
    expect(result).toEqual({ applied: 0, cleared: 1, pending: 0 });
    expect(completedIds(tab)).toEqual([GATE]);
    expect(pendingFor(tab)).toEqual([]);
  });

  it('an abandoned attempt completes nothing', async () => {
    const { tab, result } = await recoverWith((t) => { seedAttempt(t, wonAttemptRecord({ outcome: 'abandoned' })); seedPending(t, 'jat_fixture', DOT); });
    expect(result.applied).toBe(0);
    expect(completedIds(tab)).toEqual([GATE]);
  });

  it('a malformed obligation record completes nothing and is removed', async () => {
    const { tab, result } = await recoverWith((t) => {
      seedAttempt(t, wonAttemptRecord());
      window.localStorage.setItem(t.pending.getPendingCompletionStorageKey('jat_fixture'), '{"version":1,"attemptId":"jat_fixture"}');
      window.localStorage.setItem(t.pending.getPendingCompletionStorageKey('jat_garbage'), 'not json');
    });
    expect(result).toEqual({ applied: 0, cleared: 2, pending: 0 });
    expect(completedIds(tab)).toEqual([GATE]);
    expect(pendingFor(tab)).toEqual([]);
  });

  it('a malformed attempt record completes nothing', async () => {
    const { tab, result } = await recoverWith((t) => {
      window.localStorage.setItem(t.attempts.getJourneyAttemptStorageKey('jat_fixture'), JSON.stringify({ attemptId: 'jat_fixture', outcome: 'won' }));
      seedPending(t, 'jat_fixture', DOT);
    });
    expect(result.applied).toBe(0);
    expect(completedIds(tab)).toEqual([GATE]);
  });

  it('an obligation whose attempt no longer exists completes nothing', async () => {
    const { tab, result } = await recoverWith((t) => seedPending(t, 'jat_gone', DOT));
    expect(result).toEqual({ applied: 0, cleared: 1, pending: 0 });
    expect(completedIds(tab)).toEqual([GATE]);
  });

  it.each([
    ['a lesson attempt (not a match)', { kind: 'lesson' }, {}],
    ['an attempt for a different stage than the record names', { nodeId: 'ch1-n12' }, {}],
    ['a stage title that is no longer this stage (reused / renamed ID)', {}, { stage: 'First Score' }],
    ['an attempt from an older Chapter One layout', {}, { chapterLayout: 1 }],
    ['an attempt with no layout stamp at all', {}, { chapterLayout: null }],
  ])('%s is rejected', async (_label, attemptOver, detailOver) => {
    const { tab, result } = await recoverWith((t) => { seedAttempt(t, wonAttemptRecord(attemptOver, detailOver)); seedPending(t, 'jat_fixture', DOT); });
    expect(result).toEqual({ applied: 0, cleared: 1, pending: 0 });
    expect(completedIds(tab)).toEqual([GATE]);
    expect(pendingFor(tab)).toEqual([]);
  });

  it('a non-match stage (a lesson node) can never be completed through a match obligation', async () => {
    const { tab, result } = await recoverWith((t) => { seedAttempt(t, wonAttemptRecord({ nodeId: 'ch1-n08' }, { stage: 'Count the Yard' })); seedPending(t, 'jat_fixture', 'ch1-n08'); });
    expect(result.applied).toBe(0);
    expect(completedIds(tab)).toEqual([GATE]);
  });

  it('a win never skips ahead: for a stage that is not unlocked, the obligation waits and grants nothing', async () => {
    const { tab, result } = await recoverWith((t) => {
      seedAttempt(t, wonAttemptRecord({ nodeId: BOSS }, { stage: 'Handicap Stakes', rival: 'Fritz', fritzTier: 'elite', winningScore: 60 }));
      seedPending(t, 'jat_fixture', BOSS);
    });
    expect(result).toEqual({ applied: 0, cleared: 0, pending: 1 });
    expect(completedIds(tab)).toEqual([GATE]);
    expect(pendingFor(tab)).toHaveLength(1); // kept: it may become valid once the earlier stages are done
  });

  it('a stage that is already complete simply clears the obligation (no duplicate, no rewrite)', async () => {
    const { tab, result } = await recoverWith((t) => {
      t.storage.markJourneyNodeCompleted(DOT);
      seedAttempt(t, wonAttemptRecord());
      seedPending(t, 'jat_fixture', DOT);
    });
    expect(result).toEqual({ applied: 0, cleared: 1, pending: 0 });
    expect(completedIds(tab)).toEqual([GATE, DOT]);
  });

  it('a loss or an abandonment recorded through the normal path never registers an obligation', async () => {
    const tab = await openTab();
    tab.storage.markJourneyNodeCompleted(GATE);
    const lost = tab.outcome.beginJourneyMatchAttempt(tab.challenge(DOT));
    tab.outcome.recordJourneyMatchOutcome({ attemptId: lost.attemptId!, nodeId: DOT, won: false });
    const left = tab.outcome.beginJourneyMatchAttempt(tab.challenge(DOT));
    tab.outcome.abandonJourneyMatchAttempt(left.attemptId);
    expect(pendingFor(tab)).toEqual([]);
    expect(completedIds(tab)).toEqual([GATE]);
  });
});

describe('another account\'s namespace cannot complete this account\'s progress', () => {
  it('records and attempts are namespaced: user B\'s recovery ignores user A\'s owed win, and A still gets it', async () => {
    const tab = await openTab();
    const scope = await import('./journeyStorageScope');
    scope.setJourneyStorageUser('user-a');
    tab.storage.markJourneyNodeCompleted(GATE);
    const challenge = tab.outcome.beginJourneyMatchAttempt(tab.challenge(DOT));
    tab.pending.registerPendingCompletion(challenge.attemptId!, DOT);
    tab.attempts.settleJourneyAttempt(challenge.attemptId!, 'won'); // A's crash window: owed, not applied

    scope.setJourneyStorageUser('user-b');
    tab.storage.markJourneyNodeCompleted(GATE);
    expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 0, pending: 0 });
    expect(completedIds(tab)).toEqual([GATE]); // B's Dot's Table is NOT completed by A's win

    scope.setJourneyStorageUser('user-a');
    expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 });
    expect(completedIds(tab)).toEqual([GATE, DOT]);

    scope.setJourneyStorageUser('user-b');
    expect(completedIds(tab)).toEqual([GATE]); // still untouched
  });

  it('guest and signed-in namespaces are independent in the same way', async () => {
    const tab = await openTab();
    const scope = await import('./journeyStorageScope');
    tab.storage.markJourneyNodeCompleted(GATE); // guest
    const challenge = tab.outcome.beginJourneyMatchAttempt(tab.challenge(DOT));
    tab.pending.registerPendingCompletion(challenge.attemptId!, DOT);
    tab.attempts.settleJourneyAttempt(challenge.attemptId!, 'won');

    scope.setJourneyStorageUser('user-a');
    tab.storage.markJourneyNodeCompleted(GATE);
    tab.recovery.recoverPendingJourneyCompletions();
    expect(completedIds(tab)).toEqual([GATE]);
  });
});

describe('a legitimate win survives another tab writing unrelated progress concurrently', () => {
  it('sustained stale progress writes from tab B defeat the in-run retries, B\'s unrelated change is kept, and recovery later completes the stage', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tabA = await openTab();
    tabA.storage.markJourneyNodeCompleted(GATE);
    const challenge = tabA.outcome.beginJourneyMatchAttempt(tabA.challenge(DOT));
    const tabB = await openTab(); // a second tab: its own page id and module state, same storage
    const staleForB = tabB.storage.loadJourneyProgress(); // B read progress BEFORE A's win lands

    const progressKey = tabA.storage.getJourneyProgressStorageKey();
    let insideB = false;
    const restore = hookStorageWrites((key, _value, write) => {
      write();
      if (key === progressKey && !insideB) {
        insideB = true;
        tabB.storage.acknowledgeChapterCompletion('ch2-high-line', staleForB); // B's unrelated write (another chapter), built from its stale read: overwrites A's completion
        insideB = false;
      }
    });
    const result = tabA.outcome.recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true });
    restore();

    expect(result).toMatchObject({ recorded: true, completedNode: false, completionPending: true });
    expect(completedIds(tabA)).toEqual([GATE]);
    expect(tabA.storage.loadJourneyProgress().chapters['ch2-high-line']?.completionCelebrated).toBe(true); // B's unrelated write landed
    expect(pendingFor(tabA)).toHaveLength(1);

    // B goes quiet. Any later Journey load repairs it, from a fresh read that keeps B's change.
    const reloaded = await openTab();
    expect(statusOf(reloaded, DOT)).toBe('completed');
    expect(completedIds(reloaded)).toEqual([GATE, DOT]);
    expect(reloaded.storage.loadJourneyProgress().chapters['ch2-high-line']?.completionCelebrated).toBe(true); // B's unrelated change was kept by the repair
    expect(pendingFor(reloaded)).toEqual([]);
  });
});

describe('a progress reset invalidates owed completions (no resurrection)', () => {
  /** A legitimate win whose completion was never applied: steps 1-2 happened, the page died before step 3. */
  function owedWin(tab: Tab, nodeId = DOT) {
    const challenge = tab.outcome.beginJourneyMatchAttempt(tab.challenge(nodeId));
    expect(tab.pending.registerPendingCompletion(challenge.attemptId!, nodeId)).toBe(true);
    expect(tab.attempts.settleJourneyAttempt(challenge.attemptId!, 'won').changed).toBe(true);
    return challenge.attemptId!;
  }

  it('reset, then legitimately replaying the prerequisite, then loading the trail does NOT bring the reset stage back', async () => {
    const tab = await openTab();
    tab.storage.markJourneyNodeCompleted(GATE);
    const attemptId = owedWin(tab); // Dot's Table won; completion owed, not applied
    expect(completedIds(tab)).toEqual([GATE]);
    expect(pendingFor(tab)).toHaveLength(1);

    tab.storage.resetJourneyProgress(); // the user resets before recovery ever succeeded
    expect(pendingFor(tab)).toEqual([]); // the obligation is invalidated with the progress it was owed to

    tab.storage.markJourneyNodeCompleted(GATE); // the player replays Read the Gate, legitimately
    const trail = tab.mountTrail(); // the real Journey-load recovery entry point
    expect(trail.nodesWithStatus.find((node) => node.id === DOT)?.status).toBe('current'); // unlocked, NOT completed
    expect(completedIds(tab)).toEqual([GATE]);
    expect(pendingFor(tab)).toEqual([]);
    expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 0, pending: 0 });
    // the attempt history is untouched: the win is still on record, it just no longer owes progress anything
    expect(tab.attempts.loadJourneyAttempts().find((attempt) => attempt.attemptId === attemptId)?.outcome).toBe('won');
  });

  it('only the current namespace is invalidated: another user\'s and the guest\'s owed wins, and their progress, are untouched', async () => {
    const tab = await openTab();
    const scope = await import('./journeyStorageScope');

    tab.storage.markJourneyNodeCompleted(GATE); // guest
    owedWin(tab);
    scope.setJourneyStorageUser('user-b');
    tab.storage.markJourneyNodeCompleted(GATE);
    owedWin(tab);
    scope.setJourneyStorageUser('user-a');
    tab.storage.markJourneyNodeCompleted(GATE);
    owedWin(tab);
    expect(pendingFor(tab)).toHaveLength(1);

    tab.storage.resetJourneyProgress(); // reset user-a only
    expect(pendingFor(tab)).toEqual([]);
    expect(completedIds(tab)).toEqual([]);

    scope.setJourneyStorageUser('user-b');
    expect(pendingFor(tab)).toHaveLength(1); // untouched
    expect(completedIds(tab)).toEqual([GATE]);
    expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 }); // still recoverable
    expect(completedIds(tab)).toEqual([GATE, DOT]);

    scope.setJourneyStorageUser(null);
    expect(pendingFor(tab)).toHaveLength(1); // the guest's, untouched
    expect(completedIds(tab)).toEqual([GATE]);
    expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 });
  });

  it('a reset with nothing owed, or with only malformed records around, is harmless', async () => {
    const tab = await openTab();
    tab.storage.markJourneyNodeCompleted(GATE);
    window.localStorage.setItem(tab.pending.getPendingCompletionStorageKey('jat_garbage'), 'not json');
    expect(() => tab.storage.resetJourneyProgress()).not.toThrow();
    expect(pendingFor(tab)).toEqual([]);
    expect(() => tab.storage.resetJourneyProgress()).not.toThrow();
    expect(completedIds(tab)).toEqual([]);
  });

  it('a reset does not touch the attempt log or unrelated storage', async () => {
    const tab = await openTab();
    tab.storage.markJourneyNodeCompleted(GATE);
    const attemptId = owedWin(tab);
    window.localStorage.setItem('rh_unrelated_setting', '{"keep":true}');
    tab.storage.resetJourneyProgress();
    expect(tab.attempts.loadJourneyAttempts().map((attempt) => [attempt.attemptId, attempt.outcome])).toEqual([[attemptId, 'won']]);
    expect(window.localStorage.getItem('rh_unrelated_setting')).toBe('{"keep":true}');
  });

  it('a win recorded AFTER a reset is a fresh, legitimate obligation and still completes its stage', async () => {
    const tab = await openTab();
    tab.storage.markJourneyNodeCompleted(GATE);
    owedWin(tab);
    tab.storage.resetJourneyProgress();
    tab.storage.markJourneyNodeCompleted(GATE);
    const fresh = tab.outcome.beginJourneyMatchAttempt(tab.challenge(DOT));
    expect(tab.outcome.recordJourneyMatchOutcome({ attemptId: fresh.attemptId!, nodeId: DOT, won: true })).toEqual({ recorded: true, completedNode: true });
    expect(completedIds(tab)).toEqual([GATE, DOT]);
  });
});

describe('Chapter One layout version 2 and the migration remain correct', () => {
  it('a recovered completion keeps the layout stamp, and only the won stage changes', async () => {
    const before = await openTab();
    before.storage.markJourneyNodeCompleted(GATE);
    const challenge = before.outcome.beginJourneyMatchAttempt(before.challenge(DOT));
    before.pending.registerPendingCompletion(challenge.attemptId!, DOT);
    before.attempts.settleJourneyAttempt(challenge.attemptId!, 'won');
    const tab = await openTab();
    tab.mountTrail();
    expect(chapterOne(tab)).toMatchObject({ layoutVersion: 2, completedNodeIds: [GATE, DOT], completedAt: null });
  });

  it('old-layout progress is still reset by the migration, and a recorded win cannot skip the reset trail ahead', async () => {
    const before = await openTab();
    // a win recorded under layout 2, whose stage completion was owed...
    const challenge = before.outcome.beginJourneyMatchAttempt(before.challenge(DOT));
    before.pending.registerPendingCompletion(challenge.attemptId!, DOT);
    before.attempts.settleJourneyAttempt(challenge.attemptId!, 'won');
    // ...while the stored progress is from the OLD ten-node layout (no layoutVersion), claiming ch1-n01/n02 done
    window.localStorage.setItem(before.storage.getJourneyProgressStorageKey(), JSON.stringify({
      version: 2, activeChapterId: 'ch1-fritz-trail', updatedAt: '2026-01-01T00:00:00.000Z',
      chapters: { 'ch1-fritz-trail': { completedNodeIds: ['ch1-n01', 'ch1-n02'], lastVisitedNodeId: 'ch1-n02', completedAt: null, completionCelebrated: false } },
    }));

    const tab = await openTab();
    const trail = tab.mountTrail();
    expect(chapterOne(tab)).toMatchObject({ layoutVersion: 2, completedNodeIds: [] }); // the old completions are invalidated
    expect(trail.nodesWithStatus.find((node) => node.id === DOT)?.status).toBe('locked'); // Read the Gate is not done
    expect(pendingFor(tab)).toHaveLength(1); // waits: a win never skips ahead of the unlock chain
  });
});

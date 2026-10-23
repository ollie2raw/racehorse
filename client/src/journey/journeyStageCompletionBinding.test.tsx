// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LESSON_NODE,
  attemptOf,
  completedIds,
  definitionFor,
  forgedLessonAttempt,
  openTab,
  pendingFor,
  playLesson,
  seedAttempt,
  seedForgedWin,
  startLessonAttempt,
  type Tab,
} from './journeyStageCompletionTestKit';

/**
 * Corrective pass: a lesson proof is bound to the exact attempt and session it credits, and a session whose two
 * outcome records contradict each other yields no proof. Valid sessions come from the real controller; the
 * forgeries are real sessions edited afterwards. Recovery cases plant records directly, because a corrupted
 * record by definition did not come through the write path.
 */

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- editing a session to forge it
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** A session with two missed positions on the way, so history has retries to tamper with. */
const withRetries = { outcome: (stageId: string, ordinal: number) => (ordinal < 3 && stageId === 'independent-practice' ? 'failed' as const : 'passed' as const) };

/** Records `session` against a fresh attempt and reports whether anything was written. */
function tryCredit(tab: Tab, session: unknown, attemptId = startLessonAttempt(tab)) {
  const result = tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: LESSON_NODE, session: session as never });
  return { result, attemptId };
}
function expectRefusedAndInert(tab: Tab, session: unknown) {
  const before = [...completedIds(tab)];
  const { result, attemptId } = tryCredit(tab, session);
  expect(result).toEqual({ recorded: false, completedNode: false, refused: 'invalid_completion' });
  expect(attemptOf(tab, attemptId)?.outcome).toBe('in_progress'); // nothing settled
  expect(pendingFor(tab)).toEqual([]); // nothing owed
  expect(completedIds(tab)).toEqual(before); // nothing credited
}

describe('a proof is bound to its own attempt and session', () => {
  it('a genuine completed lesson is credited to its own attempt, which records the session it ran', async () => {
    const tab = await openTab();
    const attemptId = startLessonAttempt(tab);
    const session = playLesson(tab, definitionFor(tab, LESSON_NODE), { sessionId: 'session:own' });
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: LESSON_NODE, session })).toEqual({ recorded: true, completedNode: true });
    expect(completedIds(tab)).toEqual([LESSON_NODE]);
    expect(attemptOf(tab, attemptId)?.detail.sessionId).toBe('session:own');
    expect(JSON.parse(String(attemptOf(tab, attemptId)?.detail.completionProof))).toMatchObject({ sessionId: 'session:own', v: 2 });
  });

  it('legitimate retries still credit, and are recorded', async () => {
    const tab = await openTab();
    const attemptId = startLessonAttempt(tab);
    const session = playLesson(tab, definitionFor(tab, LESSON_NODE), withRetries);
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: LESSON_NODE, session })).toEqual({ recorded: true, completedNode: true });
    expect(attemptOf(tab, attemptId)?.detail.retries).toBe(2);
  });

  it('replaying a credited session against a different fresh attempt is rejected', async () => {
    const tab = await openTab();
    const session = playLesson(tab, definitionFor(tab, LESSON_NODE), { sessionId: 'session:once' });
    expect(tryCredit(tab, session).result.completedNode).toBe(true);
    tab.storage.resetJourneyProgress(); // the attempt log (history) survives a reset
    expect(completedIds(tab)).toEqual([]);
    expectRefusedAndInert(tab, session);
  });

  it('the same session ID on a different session is rejected for the later attempt', async () => {
    const tab = await openTab();
    const definition = definitionFor(tab, LESSON_NODE);
    const first = tryCredit(tab, playLesson(tab, definition, { sessionId: 'session:dup' }));
    expect(first.result.completedNode).toBe(true);
    tab.storage.resetJourneyProgress();
    expectRefusedAndInert(tab, playLesson(tab, definition, { sessionId: 'session:dup', startMs: Date.now() + 120_000 }));
  });

  it('a session that began before its attempt is rejected, as is a session with missing or malformed times', async () => {
    const tab = await openTab();
    const definition = definitionFor(tab, LESSON_NODE);
    expectRefusedAndInert(tab, playLesson(tab, definition, { startMs: Date.now() - 3_600_000 })); // an hour before the attempt
    const real = playLesson(tab, definition);
    for (const startedAt of [undefined, '', 'yesterday', null, 12345]) {
      const forged: Mutable = clone(real);
      if (startedAt === undefined) delete forged.startedAt;
      else forged.startedAt = startedAt;
      expectRefusedAndInert(tab, forged);
    }
    const noCompletionTime: Mutable = clone(real);
    noCompletionTime.completion.completedAt = 'soon';
    expectRefusedAndInert(tab, noCompletionTime);
  });

  it('an OLDER open attempt cannot claim a session another attempt already completed', async () => {
    const tab = await openTab();
    const older = startLessonAttempt(tab); // X: started first, still open
    const owner = startLessonAttempt(tab); // B: started later, runs and completes the session
    const session = playLesson(tab, definitionFor(tab, LESSON_NODE), { sessionId: 'session:owned' });
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId: owner, nodeId: LESSON_NODE, session })).toEqual({ recorded: true, completedNode: true });
    tab.storage.resetJourneyProgress(); // the attempt log keeps the claim
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId: older, nodeId: LESSON_NODE, session })).toEqual({ recorded: false, completedNode: false, refused: 'invalid_completion' });
    expect(attemptOf(tab, older)?.outcome).toBe('in_progress');
    expect(attemptOf(tab, older)?.detail.sessionId).toBeUndefined();
    expect(pendingFor(tab)).toEqual([]);
    expect(completedIds(tab)).toEqual([]);
    expect(attemptOf(tab, owner)?.detail.sessionId).toBe('session:owned'); // B's claim is untouched
  });

  it('a LATER attempt still cannot claim a session an earlier-settled attempt owns', async () => {
    const tab = await openTab();
    const owner = startLessonAttempt(tab);
    const session = playLesson(tab, definitionFor(tab, LESSON_NODE), { sessionId: 'session:owned-first' });
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId: owner, nodeId: LESSON_NODE, session }).recorded).toBe(true);
    tab.storage.resetJourneyProgress();
    const later = startLessonAttempt(tab);
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId: later, nodeId: LESSON_NODE, session })).toMatchObject({ recorded: false, refused: 'invalid_completion' });
    expect(completedIds(tab)).toEqual([]);
  });

  it('a completion that arrives after its attempt was abandoned credits nothing and leaves no obligation', async () => {
    const tab = await openTab();
    const attemptId = startLessonAttempt(tab);
    tab.attempts.settleJourneyAttempt(attemptId, 'abandoned'); // the exit / unmount path won the race
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = playLesson(tab, definitionFor(tab, LESSON_NODE));
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: LESSON_NODE, session })).toMatchObject({ recorded: false, completedNode: false, refused: 'already_terminal' });
    expect(attemptOf(tab, attemptId)?.outcome).toBe('abandoned');
    expect(pendingFor(tab)).toEqual([]);
    expect(completedIds(tab)).toEqual([]);
  });

  it('an attempt cannot be credited with a session ID the attempt does not carry (binding is recorded at settlement)', async () => {
    const tab = await openTab();
    const attemptId = startLessonAttempt(tab);
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: LESSON_NODE, session: playLesson(tab, definitionFor(tab, LESSON_NODE)) }).recorded).toBe(true);
    expect(attemptOf(tab, attemptId)?.detail.sessionId).toBe('session:test');
  });
});

describe('a session whose history contradicts its outcomes yields no proof', () => {
  const real = async () => {
    const tab = await openTab();
    const definition = definitionFor(tab, LESSON_NODE);
    return { tab, definition, session: playLesson(tab, definition, withRetries) as Mutable };
  };
  async function forgeAndExpectRefused(mutate: (session: Mutable) => void) {
    const { tab, definition, session } = await real();
    const forged = clone(session);
    mutate(forged);
    expect(tab.stage.buildJourneyLessonCompletionProof(forged as never, definition)).toBeNull();
    expectRefusedAndInert(tab, forged);
  }
  const historyOf = (session: Mutable, stageId: string) => (session.outcomeHistory as Mutable[]).filter((entry) => entry.stageId === stageId);

  it('sanity: the unmodified retried session IS accepted', async () => {
    const { tab, definition, session } = await real();
    expect(tab.stage.buildJourneyLessonCompletionProof(session as never, definition)).not.toBeNull();
  });

  it('a foreign session ID on a stage outcome', () => forgeAndExpectRefused((s) => { s.stageOutcomes[0].sessionId = 'session:other'; }));
  it('a foreign session ID on a history entry', () => forgeAndExpectRefused((s) => { s.outcomeHistory[0].sessionId = 'session:other'; }));
  it('history emptied while outcomes remain', () => forgeAndExpectRefused((s) => { s.outcomeHistory = []; }));
  it('a stage outcome that is not the last history entry of its stage', () => forgeAndExpectRefused((s) => {
    const entries = historyOf(s, 'proof');
    entries[entries.length - 1].executionId = 'exec:forged';
    s.usedExecutionIds.push('exec:forged');
  }));
  it('a stage outcome replaced by another stage\'s evidence', () => forgeAndExpectRefused((s) => {
    const practice = s.stageOutcomes.find((o: Mutable) => o.stageId === 'independent-practice');
    const index = s.stageOutcomes.findIndex((o: Mutable) => o.stageId === 'proof');
    s.stageOutcomes[index] = { ...practice, stageId: 'proof' };
  }));
  it('a missing execution (ordinals 1..n broken)', () => forgeAndExpectRefused((s) => {
    const entries = historyOf(s, 'independent-practice');
    s.outcomeHistory = s.outcomeHistory.filter((entry: Mutable) => entry !== s.outcomeHistory[s.outcomeHistory.indexOf(entries[0])]);
  }));
  it('a stage ordinal that disagrees with its history', () => forgeAndExpectRefused((s) => { s.attemptOrdinalByStageId['independent-practice'] = 7; }));
  it('two executions that both claim to have passed the stage', () => forgeAndExpectRefused((s) => {
    const first = historyOf(s, 'independent-practice')[0];
    first.outcome = 'passed';
    first.accepted = true;
  }));
  it('a repeated execution ID', () => forgeAndExpectRefused((s) => { s.outcomeHistory[1].executionId = s.outcomeHistory[0].executionId; }));
  it('an execution the session never registered', () => forgeAndExpectRefused((s) => { s.usedExecutionIds = []; }));
  it('an execution that began before the session', () => forgeAndExpectRefused((s) => { s.outcomeHistory[0].startedAt = '2000-01-01T00:00:00.000Z'; }));
  it('required stages finishing out of order', () => forgeAndExpectRefused((s) => {
    const end = s.completion.completedAt;
    for (const entry of [...historyOf(s, 'independent-practice'), ...s.stageOutcomes.filter((o: Mutable) => o.stageId === 'independent-practice')]) {
      if (entry.executionId === historyOf(s, 'independent-practice').slice(-1)[0].executionId) entry.completedAt = end;
    }
    historyOf(s, 'proof').slice(-1)[0].completedAt = s.outcomeHistory[0].startedAt > end ? end : historyOf(s, 'independent-practice')[0].completedAt;
    s.stageOutcomes.find((o: Mutable) => o.stageId === 'proof').completedAt = historyOf(s, 'proof').slice(-1)[0].completedAt;
  }));
  it('a required stage that was never completed (missing, duplicated or unaccepted)', async () => {
    await forgeAndExpectRefused((s) => { s.stageOutcomes = s.stageOutcomes.filter((o: Mutable) => o.stageId !== 'proof'); });
    await forgeAndExpectRefused((s) => { s.stageOutcomes.push({ ...s.stageOutcomes[0] }); });
    await forgeAndExpectRefused((s) => { s.completedStageIds = s.completedStageIds.filter((id: string) => id !== 'independent-practice'); });
    await forgeAndExpectRefused((s) => { for (const e of [...s.stageOutcomes, ...s.outcomeHistory]) if (e.stageId === 'proof') { e.outcome = 'failed'; e.accepted = false; } });
  });
});

describe('recovery re-checks the binding; a pending record never makes a proof valid', () => {
  const seedWon = (tab: Tab, over: Record<string, unknown> = {}, detail: Record<string, unknown> = {}) => {
    const record = forgedLessonAttempt(tab, over, detail);
    seedForgedWin(tab, record);
    return record;
  };
  async function expectCleared(prepare: (tab: Tab) => void) {
    window.localStorage.clear();
    const tab = await openTab();
    prepare(tab);
    const reloaded = await openTab();
    expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 1, pending: 0 });
    expect(completedIds(reloaded)).toEqual([]);
    expect(pendingFor(reloaded)).toEqual([]);
  }
  const futureStart = '2099-01-01T00:00:00.000Z';

  it('sanity: a properly bound record IS recovered', async () => {
    const tab = await openTab();
    seedWon(tab);
    const reloaded = await openTab();
    expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 });
  });

  it('a genuine crash window (real write path up to settlement) still recovers', async () => {
    const tab = await openTab();
    const { owedLessonWin } = await import('./journeyStageCompletionTestKit');
    owedLessonWin(tab);
    const reloaded = await openTab();
    expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 });
    expect(completedIds(reloaded)).toEqual([LESSON_NODE]);
  });

  it('an attempt that carries no session ID, or a different one than its proof', async () => {
    await expectCleared((tab) => { seedWon(tab, {}, { sessionId: undefined }); });
    await expectCleared((tab) => { seedWon(tab, {}, { sessionId: 'session:someone-else' }); });
    await expectCleared((tab) => { seedWon(tab, {}, { sessionId: '' }); });
  });

  it('a proof whose session began before the attempt did', async () => {
    await expectCleared((tab) => { seedWon(tab, { startedAt: futureStart }); });
    await expectCleared((tab) => { seedWon(tab, { startedAt: 'garbage' }); });
  });

  it('a proof in the old, unbound format', async () => {
    await expectCleared((tab) => {
      const record = forgedLessonAttempt(tab);
      const proof = JSON.parse(String(record.detail.completionProof));
      proof.v = 1;
      delete proof.startedAt;
      record.detail.completionProof = JSON.stringify(proof);
      seedForgedWin(tab, record);
    });
  });

  it('a session ID already owned by an earlier attempt cannot be reused by a later record', async () => {
    window.localStorage.clear();
    const tab = await openTab();
    const owner = forgedLessonAttempt(tab, { attemptId: 'jat_owner', startedAt: '2026-03-01T12:00:00.000Z', endedAt: '2026-03-01T12:10:00.000Z' });
    seedAttempt(tab, owner); // the attempt that settled first and really ran the session (credit long since reset)
    seedWon(tab, { attemptId: 'jat_replay', startedAt: '2026-03-02T12:00:00.000Z', endedAt: '2026-03-02T12:10:00.000Z' }); // settled later
    const reloaded = await openTab();
    expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 1, pending: 0 });
    expect(completedIds(reloaded)).toEqual([]);
  });

  it('the earlier owner of a session keeps its claim even when a later duplicate exists', async () => {
    window.localStorage.clear();
    const tab = await openTab();
    seedWon(tab, { attemptId: 'jat_owner', startedAt: '2026-03-01T12:00:00.000Z', endedAt: '2026-03-01T12:10:00.000Z' });
    seedAttempt(tab, forgedLessonAttempt(tab, { attemptId: 'jat_copy', startedAt: '2026-03-02T12:00:00.000Z', endedAt: '2026-03-02T12:10:00.000Z' }));
    const reloaded = await openTab();
    expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 });
    expect(completedIds(reloaded)).toEqual([LESSON_NODE]);
  });

  describe('duplicate carriers of one session: the attempt that settled first is the only eligible owner', () => {
    const at = (attemptId: string, startedAt: string, endedAt: unknown, extra: Record<string, unknown> = {}) =>
      ({ attemptId, startedAt, endedAt, ...extra });

    it('an earlier-STARTED but later-SETTLED attempt cannot take ownership from the one that settled first', async () => {
      window.localStorage.clear();
      const tab = await openTab();
      seedWon(tab, at('jat_x_started_first', '2026-03-01T12:00:00.000Z', '2026-03-01T12:30:00.000Z')); // settled second
      seedWon(tab, at('jat_b_settled_first', '2026-03-01T12:05:00.000Z', '2026-03-01T12:10:00.000Z')); // settled first
      const reloaded = await openTab();
      expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 1, pending: 0 });
      expect(completedIds(reloaded)).toEqual([LESSON_NODE]);
    });

    it('the competing carrier is refused on its own merits, not merely because the stage is already complete', async () => {
      window.localStorage.clear();
      const tab = await openTab();
      seedAttempt(tab, forgedLessonAttempt(tab, at('jat_b_settled_first', '2026-03-01T12:05:00.000Z', '2026-03-01T12:10:00.000Z'))); // owner, credit since reset
      seedWon(tab, at('jat_x_started_first', '2026-03-01T12:00:00.000Z', '2026-03-01T12:30:00.000Z')); // competing carrier with an obligation
      const reloaded = await openTab();
      expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 1, pending: 0 });
      expect(completedIds(reloaded)).toEqual([]);
    });

    it('identical settlement times fall back to the attempt ID, deterministically', async () => {
      for (const [pendingFor_, expected] of [['jat_a', { applied: 1, cleared: 0, pending: 0 }], ['jat_b', { applied: 0, cleared: 1, pending: 0 }]] as const) {
        window.localStorage.clear();
        const tab = await openTab();
        const same = '2026-03-01T12:10:00.000Z';
        for (const id of ['jat_a', 'jat_b']) {
          const record = forgedLessonAttempt(tab, at(id, '2026-03-01T12:00:00.000Z', same));
          if (id === pendingFor_) seedForgedWin(tab, record); else seedAttempt(tab, record);
        }
        const reloaded = await openTab();
        expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual(expected);
      }
    });

    it('a carrier with a missing or malformed settlement time can never be the earlier winner', async () => {
      for (const endedAt of [null, 'garbage', '', 12345]) {
        window.localStorage.clear();
        const tab = await openTab();
        seedAttempt(tab, forgedLessonAttempt(tab, at('jat_000_odd', '2026-03-01T11:00:00.000Z', endedAt))); // sorts first by id and start
        seedWon(tab, at('jat_valid', '2026-03-01T12:00:00.000Z', '2026-03-01T12:10:00.000Z'));
        const reloaded = await openTab();
        expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 });
      }
    });

    it('an obligation whose own settlement time is missing or malformed is not eligible', async () => {
      for (const endedAt of [null, 'garbage', '']) {
        window.localStorage.clear();
        const tab = await openTab();
        seedWon(tab, at('jat_odd', '2026-03-01T12:00:00.000Z', endedAt, { outcome: 'won' }));
        const reloaded = await openTab();
        expect(reloaded.recovery.recoverPendingJourneyCompletions()).toMatchObject({ applied: 0 });
        expect(completedIds(reloaded)).toEqual([]);
      }
    });

    it('a carrier that did not settle as a win cannot take ownership away from a genuine win', async () => {
      window.localStorage.clear();
      const tab = await openTab();
      seedAttempt(tab, forgedLessonAttempt(tab, at('jat_000_abandoned', '2026-03-01T11:00:00.000Z', '2026-03-01T11:30:00.000Z', { outcome: 'abandoned' })));
      seedWon(tab, at('jat_valid', '2026-03-01T12:00:00.000Z', '2026-03-01T12:10:00.000Z'));
      const reloaded = await openTab();
      expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 });
    });
  });
});

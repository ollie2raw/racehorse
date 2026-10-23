// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LESSON_NODE,
  PRIOR_OF_SECOND_LESSON,
  PRIOR_OF_SPRINT,
  SECOND_LESSON_NODE,
  SPRINT_NODE,
  attemptOf,
  complete,
  completedIds,
  definitionFor,
  dropProgressWrites,
  forgedLessonAttempt,
  hookStorageWrites,
  openTab,
  owedLessonWin,
  owedSprintWin,
  pendingFor,
  playLesson,
  seedAttempt,
  seedForgedWin,
  startLessonAttempt,
  startSprintAttempt,
  type Tab,
} from './journeyStageCompletionTestKit';

/** The durable lesson / sprint completion contract, part 2: forged records, sprints, reset and namespaces. */

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ================================================================= lessons: forged / malformed records

describe('recovery never credits a forged, malformed or mismatched lesson record', () => {
  const stamped = (tab: Tab, over: Record<string, unknown> = {}, detail: Record<string, unknown> = {}, nodeId = LESSON_NODE) =>
    forgedLessonAttempt(tab, over, detail, nodeId);

  async function expectNoCredit(tab: Tab, record: Record<string, unknown>, nodeId = LESSON_NODE) {
    seedForgedWin(tab, record, nodeId);
    const reloaded = await openTab();
    expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 1, pending: 0 });
    expect(completedIds(reloaded)).toEqual([]);
    expect(pendingFor(reloaded)).toEqual([]);
  }

  it('sanity: the unmodified fixture IS creditable (so the rejections below are meaningful)', async () => {
    const tab = await openTab();
    seedForgedWin(tab, stamped(tab));
    expect((await openTab()).recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 });
  });

  it('a won lesson attempt with no proof', async () => {
    const tab = await openTab();
    const record = stamped(tab);
    delete (record.detail as Record<string, unknown>).completionProof;
    await expectNoCredit(tab, record);
  });

  it('a "requiredStagesPassed" flag and a contentId are not evidence', async () => {
    const tab = await openTab();
    const record = stamped(tab, {}, { requiredStagesPassed: true });
    record.detail.completionProof = JSON.stringify({ v: 1, requiredStagesPassed: true });
    await expectNoCredit(tab, record);
  });

  it('a proof whose required stage failed', async () => {
    const tab = await openTab();
    const record = stamped(tab);
    const proof = JSON.parse(String(record.detail.completionProof));
    proof.stages[1].outcome = 'failed';
    record.detail.completionProof = JSON.stringify(proof);
    await expectNoCredit(tab, record);
  });

  it('a proof that omits a required stage', async () => {
    const tab = await openTab();
    const record = stamped(tab);
    const proof = JSON.parse(String(record.detail.completionProof));
    proof.stages = proof.stages.slice(0, 1);
    record.detail.completionProof = JSON.stringify(proof);
    await expectNoCredit(tab, record);
  });

  it('unparseable, non-object or oversized-garbage proof', async () => {
    for (const garbage of ['not json', '"passed"', '[]', 'null', '{']) {
      window.localStorage.clear();
      const tab = await openTab();
      const record = stamped(tab);
      record.detail.completionProof = garbage;
      await expectNoCredit(tab, record);
    }
  });

  it('a proof for a different lesson on this node, and a contentId that does not match', async () => {
    const tab = await openTab();
    const other = definitionFor(tab, SECOND_LESSON_NODE);
    const otherProof = tab.stage.buildJourneyLessonCompletionProof(playLesson(tab, other), other)!;
    await expectNoCredit(tab, stamped(tab, {}, { completionProof: JSON.stringify(otherProof) }));
    window.localStorage.clear();
    const tab2 = await openTab();
    await expectNoCredit(tab2, stamped(tab2, {}, { contentId: String(other.id) }));
  });

  it('a record whose proof was built for an older content version', async () => {
    const tab = await openTab();
    const record = stamped(tab);
    const proof = JSON.parse(String(record.detail.completionProof));
    proof.contentVersion = proof.contentVersion + 1;
    record.detail.completionProof = JSON.stringify(proof);
    await expectNoCredit(tab, record);
  });

  it('the wrong node: an open-end proof presented for Count the Yard', async () => {
    const tab = await openTab();
    complete(tab, PRIOR_OF_SECOND_LESSON);
    const record = stamped(tab, { nodeId: SECOND_LESSON_NODE }, { stage: 'Count the Yard' });
    seedForgedWin(tab, record, SECOND_LESSON_NODE);
    const reloaded = await openTab();
    expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 1, pending: 0 });
    expect(completedIds(reloaded)).toEqual(PRIOR_OF_SECOND_LESSON);
  });

  it('an obligation whose node differs from the attempt\'s node', async () => {
    const tab = await openTab();
    complete(tab, PRIOR_OF_SECOND_LESSON);
    seedAttempt(tab, stamped(tab));
    expect(tab.pending.registerPendingCompletion('jat_forged', SECOND_LESSON_NODE)).toBe(true);
    const reloaded = await openTab();
    expect(reloaded.recovery.recoverPendingJourneyCompletions()).toMatchObject({ applied: 0, cleared: 1 });
    expect(completedIds(reloaded)).toEqual(PRIOR_OF_SECOND_LESSON);
  });

  it('abandoned, lost and in-progress lesson attempts with an obligation and a perfectly valid proof', async () => {
    const tab = await openTab();
    for (const outcome of ['abandoned', 'lost']) {
      window.localStorage.clear();
      await expectNoCredit(await openTab(), stamped(tab, { outcome }));
    }
    window.localStorage.clear();
    const live = await openTab();
    const record = stamped(live, { outcome: 'in_progress', endedAt: null });
    seedAttempt(live, { ...record, ownerId: 'someone-elses-page', heartbeatAt: new Date().toISOString() });
    live.pending.registerPendingCompletion('jat_forged', LESSON_NODE);
    expect(live.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 0, pending: 1 }); // in flight: not credited, not removed
    expect(completedIds(live)).toEqual([]);
  });

  it('a lesson proof carried by a sprint or match attempt, and a match-style attempt on a lesson node', async () => {
    const tab = await openTab();
    await expectNoCredit(tab, stamped(tab, { kind: 'match' }));
    window.localStorage.clear();
    const tab2 = await openTab();
    await expectNoCredit(tab2, stamped(tab2, { kind: 'sprint' }));
  });

  it('a stale Chapter One layout stamp', async () => {
    const tab = await openTab();
    await expectNoCredit(tab, stamped(tab, {}, { chapterLayout: 1 }));
    window.localStorage.clear();
    const tab2 = await openTab();
    await expectNoCredit(tab2, stamped(tab2, {}, { chapterLayout: null }));
  });

  it('a stage title that no longer matches the node (reused or renamed ID)', async () => {
    const tab = await openTab();
    await expectNoCredit(tab, stamped(tab, {}, { stage: 'Some Other Stage' }));
  });

  it('a locked stage keeps a valid obligation waiting; a win never skips ahead', async () => {
    const tab = await openTab();
    const record = stamped(tab, { nodeId: SECOND_LESSON_NODE }, { stage: 'Count the Yard' });
    seedForgedWin(tab, record, SECOND_LESSON_NODE);
    // the fixture's proof is the open-end lesson's, so it is invalid for this node too; build a valid one
    window.localStorage.clear();
    const definition = definitionFor(tab, SECOND_LESSON_NODE);
    const proof = tab.stage.buildJourneyLessonCompletionProof(playLesson(tab, definition), definition)!;
    seedForgedWin(tab, stamped(tab, { nodeId: SECOND_LESSON_NODE }, { stage: 'Count the Yard', contentId: String(definition.id), completionProof: JSON.stringify(proof) }), SECOND_LESSON_NODE);
    expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 0, pending: 1 });
    expect(completedIds(tab)).toEqual([]);
    complete(tab, PRIOR_OF_SECOND_LESSON); // prerequisites done later → the owed completion is honoured
    expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 });
  });
});

// ================================================================= sprints

describe('a sprint completion goes through the same durable sequence', () => {
  async function sprintTab() {
    const tab = await openTab();
    complete(tab, PRIOR_OF_SPRINT);
    return tab;
  }
  const size = (tab: Tab) => tab.sprints.getJourneyPuzzleSprint(SPRINT_NODE)!.length;

  it('documents the threshold: ceil(total / 2) correct, and the registered set size is the total', async () => {
    const tab = await sprintTab();
    const total = size(tab);
    expect(total).toBe(3);
    expect([0, 1, 2, 3].map((correct) => tab.stage.journeySprintPasses(correct, total))).toEqual([false, false, true, true]);
    expect(tab.stage.journeySprintPasses(2, 4)).toBe(true);
    expect(tab.stage.journeySprintPasses(1, 4)).toBe(false);
    expect(tab.stage.journeySprintPasses(1, 1)).toBe(true);
    expect(tab.stage.journeySprintPasses(0, 0)).toBe(false);
    expect([[NaN, 3], [2.5, 3], [-1, 3], [4, 3], [2, NaN], [2, Infinity]].map(([c, t]) => tab.stage.journeySprintPasses(c, t))).toEqual([false, false, false, false, false, false]);
  });

  it('a genuine pass records a won attempt with its result, credits the node, and leaves no obligation', async () => {
    const tab = await sprintTab();
    const attemptId = startSprintAttempt(tab);
    expect(tab.stage.recordJourneySprintResult({ attemptId, nodeId: SPRINT_NODE, correct: 2, total: size(tab) })).toEqual({ recorded: true, completedNode: true });
    expect(completedIds(tab)).toContain(SPRINT_NODE);
    expect(pendingFor(tab)).toEqual([]);
    expect(attemptOf(tab, attemptId)).toMatchObject({ outcome: 'won', detail: { correct: 2, total: 3 } });
  });

  it('writes pending → attempt → progress, in that order', async () => {
    const tab = await sprintTab();
    const attemptId = startSprintAttempt(tab);
    const order: string[] = [];
    const restore = hookStorageWrites((key, _value, write) => {
      if (key.startsWith('rh_journey_pending_completion_v1')) order.push('pending');
      else if (key.includes(':a:')) order.push('attempt');
      else if (key.startsWith('rh_journey_progress_v1')) order.push('progress');
      write();
    });
    tab.stage.recordJourneySprintResult({ attemptId, nodeId: SPRINT_NODE, correct: 3, total: 3 });
    restore();
    expect(order).toEqual(['pending', 'attempt', 'progress']);
  });

  it('a failed sprint records a loss and can never become a recoverable win', async () => {
    const tab = await sprintTab();
    const attemptId = startSprintAttempt(tab);
    expect(tab.stage.recordJourneySprintResult({ attemptId, nodeId: SPRINT_NODE, correct: 1, total: 3 })).toEqual({ recorded: true, completedNode: false });
    expect(attemptOf(tab, attemptId)?.outcome).toBe('lost');
    expect(completedIds(tab)).not.toContain(SPRINT_NODE);
    expect(pendingFor(tab)).toEqual([]);
    // even with an obligation planted for the lost attempt, recovery refuses it
    tab.pending.registerPendingCompletion(attemptId, SPRINT_NODE);
    expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 1, pending: 0 });
    expect(completedIds(tab)).not.toContain(SPRINT_NODE);
  });

  it('a result that does not match the registered puzzle set is refused and writes nothing', async () => {
    const tab = await sprintTab();
    for (const [correct, total] of [[3, 5], [1, 1], [2, 2], [5, 5]]) {
      const attemptId = startSprintAttempt(tab);
      expect(tab.stage.recordJourneySprintResult({ attemptId, nodeId: SPRINT_NODE, correct, total })).toEqual({ recorded: false, completedNode: false, refused: 'invalid_completion' });
      expect(attemptOf(tab, attemptId)?.outcome).toBe('in_progress');
      tab.attempts.settleJourneyAttempt(attemptId, 'abandoned');
    }
    expect(completedIds(tab)).not.toContain(SPRINT_NODE);
    expect(pendingFor(tab)).toEqual([]);
  });

  it('malformed numbers never pass: they are recorded as a loss, never credited', async () => {
    const tab = await sprintTab();
    for (const [correct, total] of [[NaN, 3], [2.5, 3], [-1, 3], [4, 3]]) {
      const attemptId = startSprintAttempt(tab);
      const result = tab.stage.recordJourneySprintResult({ attemptId, nodeId: SPRINT_NODE, correct, total });
      expect(result.completedNode).toBe(false);
      expect(attemptOf(tab, attemptId)?.outcome).not.toBe('won');
    }
    expect(completedIds(tab)).not.toContain(SPRINT_NODE);
  });

  it('an abandoned or never-finished sprint (unmount / exit) is never credited', async () => {
    const tab = await sprintTab();
    const attemptId = startSprintAttempt(tab);
    tab.attempts.settleJourneyAttempt(attemptId, 'abandoned');
    expect(tab.stage.recordJourneySprintResult({ attemptId, nodeId: SPRINT_NODE, correct: 3, total: 3 })).toMatchObject({ recorded: false, completedNode: false, refused: 'already_terminal' });
    expect(completedIds(tab)).not.toContain(SPRINT_NODE);
    expect(pendingFor(tab)).toEqual([]);
  });

  it('wrong identity: a lesson attempt, another node, or no attempt', async () => {
    const tab = await sprintTab();
    const lessonAttempt = startLessonAttempt(tab, LESSON_NODE);
    expect(tab.stage.recordJourneySprintResult({ attemptId: lessonAttempt, nodeId: SPRINT_NODE, correct: 3, total: 3 })).toMatchObject({ recorded: false, refused: 'unknown_attempt_or_stage' });
    const sprintAttempt = startSprintAttempt(tab);
    expect(tab.stage.recordJourneySprintResult({ attemptId: sprintAttempt, nodeId: LESSON_NODE, correct: 3, total: 3 })).toMatchObject({ recorded: false });
    expect(tab.stage.recordJourneySprintResult({ attemptId: null, nodeId: SPRINT_NODE, correct: 3, total: 3 })).toMatchObject({ recorded: false });
    expect(completedIds(tab)).not.toContain(SPRINT_NODE);
  });

  it('a progress write that fails is recovered on the next Journey load', async () => {
    const tab = await sprintTab();
    const attemptId = startSprintAttempt(tab);
    const restore = dropProgressWrites(99);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(tab.stage.recordJourneySprintResult({ attemptId, nodeId: SPRINT_NODE, correct: 3, total: 3 })).toEqual({ recorded: true, completedNode: false, completionPending: true });
    restore();
    expect(pendingFor(tab)).toHaveLength(1);
    const reloaded = await openTab();
    expect(reloaded.mountTrail().nodesWithStatus.find((node) => node.id === SPRINT_NODE)?.status).toBe('completed');
    expect(pendingFor(reloaded)).toEqual([]);
  });

  it('crash boundaries: before settle (nothing), after settle (recovered once), after apply before cleanup (cleaned only)', async () => {
    const tab = await sprintTab();
    const open = startSprintAttempt(tab);
    tab.pending.registerPendingCompletion(open, SPRINT_NODE); // boundary 1: obligation only
    expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 0, pending: 1 });
    tab.attempts.settleJourneyAttempt(open, 'abandoned');
    expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 1, pending: 0 });
    expect(completedIds(tab)).not.toContain(SPRINT_NODE);

    owedSprintWin(tab); // boundary 2
    const reloaded = await openTab();
    expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 });
    expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 0, pending: 0 }); // idempotent

    window.localStorage.clear();
    const tab3 = await sprintTab();
    owedSprintWin(tab3); // boundary 3
    complete(tab3, [SPRINT_NODE]);
    const before = JSON.stringify(tab3.storage.loadJourneyProgress());
    expect(tab3.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 1, pending: 0 });
    expect(JSON.stringify(tab3.storage.loadJourneyProgress())).toBe(before);
  });

  describe('forged sprint records', () => {
    const record = (tab: Tab, over: Record<string, unknown> = {}, detail: Record<string, unknown> = {}) => ({
      attemptId: 'jat_forged_sprint', nodeId: SPRINT_NODE, kind: 'sprint', outcome: 'won',
      startedAt: '2026-03-01T12:00:00.000Z', endedAt: '2026-03-01T12:10:00.000Z', ownerId: null, heartbeatAt: null,
      detail: { stage: 'Quick Reads', chapterLayout: 2, correct: 3, total: size(tab), ...detail },
      ...over,
    });
    async function noCredit(over: Record<string, unknown>, detail: Record<string, unknown>) {
      window.localStorage.clear();
      const tab = await sprintTab();
      seedAttempt(tab, record(tab, over, detail));
      tab.pending.registerPendingCompletion('jat_forged_sprint', SPRINT_NODE);
      const reloaded = await openTab();
      expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 1, pending: 0 });
      expect(completedIds(reloaded)).not.toContain(SPRINT_NODE);
    }

    it('sanity: the unmodified fixture IS creditable', async () => {
      const tab = await sprintTab();
      seedAttempt(tab, record(tab));
      tab.pending.registerPendingCompletion('jat_forged_sprint', SPRINT_NODE);
      expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 });
    });
    it('below threshold, over total, wrong total, missing or non-numeric result', async () => {
      await noCredit({}, { correct: 1 });
      await noCredit({}, { correct: 4, total: 3 });
      await noCredit({}, { correct: 1, total: 1 });
      await noCredit({}, { correct: 5, total: 5 });
      await noCredit({}, { correct: undefined as never });
      await noCredit({}, { correct: '3' });
      await noCredit({}, { total: null });
    });
    it('a won attempt of the wrong kind, outcome, stage title or layout', async () => {
      await noCredit({ kind: 'lesson' }, {});
      await noCredit({ kind: 'match' }, {});
      await noCredit({ outcome: 'lost' }, {});
      await noCredit({ outcome: 'abandoned' }, {});
      await noCredit({}, { stage: 'Not Quick Reads' });
      await noCredit({}, { chapterLayout: 1 });
    });
  });
});

// ================================================================= reset and namespaces

describe('reset and namespace isolation hold for lessons and sprints', () => {
  it('a reset after an owed lesson win does not resurrect it, even after the prerequisites are replayed', async () => {
    const tab = await openTab();
    complete(tab, PRIOR_OF_SECOND_LESSON);
    const attemptId = owedLessonWin(tab, SECOND_LESSON_NODE);
    expect(pendingFor(tab)).toHaveLength(1);
    tab.storage.resetJourneyProgress();
    expect(pendingFor(tab)).toEqual([]);
    complete(tab, PRIOR_OF_SECOND_LESSON); // replay the prerequisites legitimately
    const trail = tab.mountTrail();
    expect(trail.nodesWithStatus.find((node) => node.id === SECOND_LESSON_NODE)?.status).toBe('current'); // unlocked, NOT completed
    expect(completedIds(tab)).toEqual(PRIOR_OF_SECOND_LESSON);
    expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 0, pending: 0 });
    expect(attemptOf(tab, attemptId)?.outcome).toBe('won'); // history is kept
  });

  it('a reset after an owed sprint win does not resurrect it', async () => {
    const tab = await openTab();
    complete(tab, PRIOR_OF_SPRINT);
    owedSprintWin(tab);
    tab.storage.resetJourneyProgress();
    complete(tab, PRIOR_OF_SPRINT);
    tab.mountTrail();
    expect(completedIds(tab)).toEqual(PRIOR_OF_SPRINT);
    expect(pendingFor(tab)).toEqual([]);
  });

  it('guest, user A and user B each keep their own owed wins; a reset touches only its own namespace', async () => {
    const tab = await openTab();
    complete(tab, PRIOR_OF_SECOND_LESSON);
    owedLessonWin(tab, SECOND_LESSON_NODE); // guest: an owed lesson win
    tab.scope.setJourneyStorageUser('user-a');
    complete(tab, PRIOR_OF_SPRINT);
    owedSprintWin(tab); // user A: an owed sprint win
    tab.scope.setJourneyStorageUser('user-b');
    complete(tab, PRIOR_OF_SECOND_LESSON);
    owedLessonWin(tab, SECOND_LESSON_NODE); // user B: an owed lesson win
    for (const user of [null, 'user-a', 'user-b']) {
      tab.scope.setJourneyStorageUser(user);
      expect(pendingFor(tab)).toHaveLength(1);
    }

    tab.scope.setJourneyStorageUser('user-a');
    tab.storage.resetJourneyProgress();
    expect(pendingFor(tab)).toEqual([]);
    expect(completedIds(tab)).toEqual([]);

    tab.scope.setJourneyStorageUser('user-b');
    expect(pendingFor(tab)).toHaveLength(1); // untouched
    expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 });
    expect(completedIds(tab)).toEqual([...PRIOR_OF_SECOND_LESSON, SECOND_LESSON_NODE]);

    tab.scope.setJourneyStorageUser(null);
    expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 });
    expect(completedIds(tab)).toEqual([...PRIOR_OF_SECOND_LESSON, SECOND_LESSON_NODE]);

    tab.scope.setJourneyStorageUser('user-a');
    expect(completedIds(tab)).toEqual([]); // user A's reset stands: nothing leaked in from B or the guest
  });

  it('an obligation owed in one namespace is never honoured in another', async () => {
    const tab = await openTab();
    complete(tab, PRIOR_OF_SECOND_LESSON);
    owedLessonWin(tab, SECOND_LESSON_NODE); // guest
    tab.scope.setJourneyStorageUser('user-a');
    complete(tab, PRIOR_OF_SECOND_LESSON);
    expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 0, pending: 0 });
    expect(completedIds(tab)).toEqual(PRIOR_OF_SECOND_LESSON);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LESSON_NODE,
  PRIOR_OF_SECOND_LESSON,
  SECOND_LESSON_NODE,
  attemptOf,
  complete,
  completedIds,
  definitionFor,
  dropProgressWrites,
  hookStorageWrites,
  openTab,
  owedLessonWin,
  pendingFor,
  playLesson,
  startLessonAttempt,
  startSprintAttempt,
} from './journeyStageCompletionTestKit';

/** The durable lesson / sprint completion contract, part 1: proof derivation, the write path and crash boundaries. See the test kit for what is real and what is simulated. */

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ================================================================= the proof is derived from the controller

describe('a completion proof is derived from a genuinely completed controller session', () => {
  it('every production lesson, played to completion by the controller, yields a proof that verifies against its definition', async () => {
    const tab = await openTab();
    const definitions = tab.resolver.getAllJourneyLessonDefinitions();
    expect(definitions.length).toBeGreaterThanOrEqual(8);
    for (const definition of definitions) {
      const session = playLesson(tab, definition);
      expect(session.status, definition.id).toBe('completed');
      const proof = tab.stage.buildJourneyLessonCompletionProof(session, definition);
      expect(proof, definition.id).not.toBeNull();
      expect(tab.stage.verifyJourneyLessonCompletionProof(proof, definition), definition.id).toEqual([]);
      expect(proof!.retries).toBe(0);
    }
  });

  it('retries are recorded honestly: a stage passed on its third position says so', async () => {
    const tab = await openTab();
    const definition = definitionFor(tab, LESSON_NODE);
    const session = playLesson(tab, definition, { outcome: (stageId, ordinal) => (stageId === 'proof' && ordinal < 3 ? 'failed' : 'passed') });
    expect(session.status).toBe('completed');
    const proof = tab.stage.buildJourneyLessonCompletionProof(session, definition)!;
    expect(proof.stages.find((entry) => entry.stageId === 'proof')).toMatchObject({ outcome: 'passed', attempts: 3 });
    expect(proof.retries).toBe(2);
  });

  it('a session that is partial, mid-execution or abandoned yields NO proof', async () => {
    const tab = await openTab();
    const definition = definitionFor(tab, LESSON_NODE);
    const partial = playLesson(tab, definition, { stopAtStageId: 'proof' });
    expect(partial.status).toBe('active');
    expect(tab.stage.buildJourneyLessonCompletionProof(partial, definition)).toBeNull();
    const midProof = playLesson(tab, definition, { stopMidExecutionOf: 'proof' });
    expect(tab.stage.buildJourneyLessonCompletionProof(midProof, definition)).toBeNull();
    const abandoned = playLesson(tab, definition, { abandonAfterSteps: 6 });
    expect(abandoned.status).toBe('abandoned');
    expect(tab.stage.buildJourneyLessonCompletionProof(abandoned, definition)).toBeNull();
  });

  it('retry exhaustion: a stage left in its retry state (no position left to play) never completes', async () => {
    const tab = await openTab();
    const definition = definitionFor(tab, LESSON_NODE);
    // The host stops at `awaiting_retry` with an error when no unused position remains; model that state.
    const stuck = playLesson(tab, definition, { outcome: () => 'failed', abandonAfterSteps: 40 });
    expect(stuck.status).not.toBe('completed');
    expect(tab.stage.buildJourneyLessonCompletionProof(stuck, definition)).toBeNull();
    const attemptId = startLessonAttempt(tab);
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: LESSON_NODE, session: stuck })).toMatchObject({ recorded: false, completedNode: false, refused: 'invalid_completion' });
    expect(attemptOf(tab, attemptId)?.outcome).toBe('in_progress');
  });

  it('a completed session that does not actually satisfy the rule yields no proof (forged controller state)', async () => {
    const tab = await openTab();
    const definition = definitionFor(tab, LESSON_NODE);
    const real = playLesson(tab, definition);
    const claimsCompleteWithoutOutcome = { ...real, stageOutcomes: real.stageOutcomes.filter((outcome) => outcome.stageId !== 'proof') };
    expect(tab.stage.buildJourneyLessonCompletionProof(claimsCompleteWithoutOutcome, definition)).toBeNull();
    const proofStageOnlyCompleted = { ...real, stageOutcomes: real.stageOutcomes.map((outcome) => (outcome.stageId === 'proof' ? { ...outcome, outcome: 'completed' as const } : outcome)) };
    expect(tab.stage.buildJourneyLessonCompletionProof(proofStageOnlyCompleted, definition)).toBeNull(); // proof stages need `passed`
    const missingStageId = { ...real, completedStageIds: real.completedStageIds.filter((id) => id !== 'proof') };
    expect(tab.stage.buildJourneyLessonCompletionProof(missingStageId, definition)).toBeNull();
    const noCompletion = { ...real, completion: null };
    expect(tab.stage.buildJourneyLessonCompletionProof(noCompletion, definition)).toBeNull();
  });

  it('a session of a different lesson cannot produce a proof for this definition', async () => {
    const tab = await openTab();
    const other = playLesson(tab, definitionFor(tab, SECOND_LESSON_NODE));
    expect(tab.stage.buildJourneyLessonCompletionProof(other, definitionFor(tab, LESSON_NODE))).toBeNull();
  });

  it('verification rejects malformed, mismatched or hollow proofs (nothing in the proof is trusted)', async () => {
    const tab = await openTab();
    const definition = definitionFor(tab, LESSON_NODE);
    const proof = tab.stage.buildJourneyLessonCompletionProof(playLesson(tab, definition), definition)!;
    const bad = (mutate: (copy: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(proof)) as Record<string, unknown>;
      mutate(copy);
      return tab.stage.verifyJourneyLessonCompletionProof(copy, definition);
    };
    expect(tab.stage.verifyJourneyLessonCompletionProof(null, definition)).not.toEqual([]);
    expect(tab.stage.verifyJourneyLessonCompletionProof('passed', definition)).not.toEqual([]);
    expect(bad((p) => { p.contentId = 'premium:other'; })).not.toEqual([]);
    expect(bad((p) => { p.nodeId = 'ch1-n08'; })).not.toEqual([]);
    expect(bad((p) => { p.contentVersion = 99; })).not.toEqual([]); // content changed since: not creditable
    expect(bad((p) => { p.rule = 'scorecard'; })).not.toEqual([]);
    expect(bad((p) => { p.v = 1; })).not.toEqual([]); // the pre-binding proof format is no longer accepted
    expect(bad((p) => { p.v = 3; })).not.toEqual([]);
    expect(bad((p) => { p.startedAt = 'later'; })).not.toEqual([]);
    expect(bad((p) => { p.completedAt = '2000-01-01T00:00:00.000Z'; })).not.toEqual([]); // completes before it started
    expect(bad((p) => { (p.stages as Array<Record<string, unknown>>)[1].executionId = (p.stages as Array<Record<string, unknown>>)[0].executionId; })).not.toEqual([]);
    expect(bad((p) => { (p.stages as Array<Record<string, unknown>>)[0].executionId = ''; })).not.toEqual([]);
    expect(bad((p) => { p.stages = []; p.requiredStagesPassed = true; })).not.toEqual([]); // a flag is not evidence
    expect(bad((p) => { (p.stages as Array<Record<string, unknown>>)[1].outcome = 'failed'; })).not.toEqual([]);
    expect(bad((p) => { (p.stages as Array<Record<string, unknown>>)[1].outcome = 'completed'; })).not.toEqual([]); // proof needs passed
    expect(bad((p) => { (p.stages as Array<Record<string, unknown>>)[0].attempts = 0; })).not.toEqual([]);
    expect(bad((p) => { (p.stages as Array<Record<string, unknown>>).pop(); })).not.toEqual([]);
    expect(bad((p) => { p.retries = 5; })).not.toEqual([]); // must agree with the per-stage attempts
    expect(bad((p) => { p.completedAt = 'not a time'; })).not.toEqual([]);
  });
});

// ================================================================= lessons: the write path

describe('a lesson completion goes through the durable sequence', () => {
  it('a genuine completion records a won attempt carrying its proof, credits the node, and leaves no obligation', async () => {
    const tab = await openTab();
    const definition = definitionFor(tab, LESSON_NODE);
    const attemptId = startLessonAttempt(tab);
    const result = tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: LESSON_NODE, session: playLesson(tab, definition, { outcome: (stageId, n) => (stageId === 'practice' && n < 2 ? 'failed' : 'passed') }) });
    expect(result).toEqual({ recorded: true, completedNode: true });
    expect(completedIds(tab)).toEqual([LESSON_NODE]);
    expect(pendingFor(tab)).toEqual([]);
    const stored = attemptOf(tab, attemptId)!;
    expect(stored.outcome).toBe('won');
    expect(JSON.parse(String(stored.detail.completionProof))).toMatchObject({ contentId: String(definition.id), nodeId: LESSON_NODE });
  });

  it('writes pending → attempt → progress, in that order (never completed before settled)', async () => {
    const tab = await openTab();
    const definition = definitionFor(tab, LESSON_NODE);
    const attemptId = startLessonAttempt(tab);
    const session = playLesson(tab, definition);
    const order: string[] = [];
    const restore = hookStorageWrites((key, _value, write) => {
      if (key.startsWith('rh_journey_pending_completion_v1')) order.push('pending');
      else if (key.includes(':a:')) order.push('attempt');
      else if (key.startsWith('rh_journey_progress_v1')) order.push('progress');
      write();
    });
    tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: LESSON_NODE, session });
    restore();
    expect(order).toEqual(['pending', 'attempt', 'progress']);
  });

  it('an incomplete or abandoned session writes NOTHING: no won attempt, no obligation, no credit', async () => {
    const tab = await openTab();
    const definition = definitionFor(tab, LESSON_NODE);
    for (const session of [
      playLesson(tab, definition, { stopAtStageId: 'proof' }),
      playLesson(tab, definition, { stopMidExecutionOf: 'independent-practice' }),
      playLesson(tab, definition, { abandonAfterSteps: 6 }),
    ]) {
      expect(['active', 'abandoned']).toContain(session.status);
      const attemptId = startLessonAttempt(tab);
      expect(tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: LESSON_NODE, session })).toEqual({ recorded: false, completedNode: false, refused: 'invalid_completion' });
      expect(attemptOf(tab, attemptId)?.outcome).toBe('in_progress');
      expect(pendingFor(tab)).toEqual([]);
      expect(completedIds(tab)).toEqual([]);
      tab.attempts.settleJourneyAttempt(attemptId, 'abandoned'); // the screen's exit / unmount path
      expect(attemptOf(tab, attemptId)?.outcome).toBe('abandoned');
    }
  });

  it('wrong identity is refused: another lesson\'s session, another node, another kind of attempt', async () => {
    const tab = await openTab();
    const attemptId = startLessonAttempt(tab, LESSON_NODE);
    const countingSession = playLesson(tab, definitionFor(tab, SECOND_LESSON_NODE));
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: LESSON_NODE, session: countingSession })).toMatchObject({ recorded: false, refused: 'invalid_completion' });
    const openEnd = playLesson(tab, definitionFor(tab, LESSON_NODE));
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: SECOND_LESSON_NODE, session: openEnd })).toMatchObject({ recorded: false, refused: 'unknown_attempt_or_stage' });
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId: null, nodeId: LESSON_NODE, session: openEnd })).toMatchObject({ recorded: false });
    const sprintAttempt = startSprintAttempt(tab);
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId: sprintAttempt, nodeId: LESSON_NODE, session: openEnd })).toMatchObject({ recorded: false });
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId: 'jat_nope', nodeId: LESSON_NODE, session: openEnd })).toMatchObject({ recorded: false, refused: 'unknown_attempt_or_stage' });
    expect(completedIds(tab)).toEqual([]);
    expect(pendingFor(tab)).toEqual([]);
  });

  it('a lesson attempt can never be settled through the match path (and vice versa)', async () => {
    const tab = await openTab();
    const attemptId = startLessonAttempt(tab);
    expect(tab.outcome.recordJourneyMatchOutcome({ attemptId, nodeId: LESSON_NODE, won: true })).toEqual({ recorded: false, completedNode: false, refused: 'unknown_attempt_or_stage' });
    expect(attemptOf(tab, attemptId)?.outcome).toBe('in_progress');
    expect(completedIds(tab)).toEqual([]);
  });

  it('duplicate completion callbacks are idempotent: one win, one credit, no second record', async () => {
    const tab = await openTab();
    const definition = definitionFor(tab, LESSON_NODE);
    const attemptId = startLessonAttempt(tab);
    const session = playLesson(tab, definition);
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: LESSON_NODE, session })).toEqual({ recorded: true, completedNode: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: LESSON_NODE, session })).toMatchObject({ recorded: false, completedNode: false, refused: 'already_terminal' });
    expect(warn).not.toHaveBeenCalled(); // a duplicate is quiet
    expect(completedIds(tab)).toEqual([LESSON_NODE]);
    expect(tab.attempts.loadJourneyAttempts().filter((attempt) => attempt.outcome === 'won')).toHaveLength(1);
    expect(pendingFor(tab)).toEqual([]);
  });

  it('replaying a completed lesson records the attempt but changes no progress and owes nothing', async () => {
    const tab = await openTab();
    complete(tab, [LESSON_NODE]);
    const before = JSON.stringify(tab.storage.loadJourneyProgress());
    const definition = definitionFor(tab, LESSON_NODE);
    const attemptId = startLessonAttempt(tab);
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: LESSON_NODE, session: playLesson(tab, definition) })).toEqual({ recorded: true, completedNode: false });
    expect(JSON.stringify(tab.storage.loadJourneyProgress())).toBe(before);
    expect(pendingFor(tab)).toEqual([]);
  });

  it('a lesson that is not unlocked records its attempt but never skips ahead', async () => {
    const tab = await openTab();
    const definition = definitionFor(tab, SECOND_LESSON_NODE); // Count the Yard: its prerequisites are not done
    const attemptId = startLessonAttempt(tab, SECOND_LESSON_NODE);
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: SECOND_LESSON_NODE, session: playLesson(tab, definition) })).toEqual({ recorded: true, completedNode: false });
    expect(completedIds(tab)).toEqual([]);
    expect(pendingFor(tab)).toEqual([]);
  });
});

// ================================================================= lessons: crash boundaries and recovery

describe('lesson crash boundaries', () => {
  it('a progress write that fails at the completion boundary is recovered on the next Journey load', async () => {
    const tab = await openTab();
    const definition = definitionFor(tab, LESSON_NODE);
    const attemptId = startLessonAttempt(tab);
    const session = playLesson(tab, definition);
    const restore = dropProgressWrites(99); // every progress write fails, including the in-run retries
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: LESSON_NODE, session });
    restore();
    expect(result).toEqual({ recorded: true, completedNode: false, completionPending: true });
    expect(warn).toHaveBeenCalled();
    expect(completedIds(tab)).toEqual([]);
    expect(pendingFor(tab)).toHaveLength(1); // the obligation survives

    const reloaded = await openTab(); // the page is reloaded
    const trail = reloaded.mountTrail();
    expect(trail.nodesWithStatus.find((node) => node.id === LESSON_NODE)?.status).toBe('completed');
    expect(completedIds(reloaded)).toEqual([LESSON_NODE]);
    expect(pendingFor(reloaded)).toEqual([]);
  });

  it('a couple of lost writes are repaired inside the same run', async () => {
    const tab = await openTab();
    const definition = definitionFor(tab, LESSON_NODE);
    const attemptId = startLessonAttempt(tab);
    const session = playLesson(tab, definition);
    const restore = dropProgressWrites(2);
    const result = tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: LESSON_NODE, session });
    restore();
    expect(result).toEqual({ recorded: true, completedNode: true });
    expect(pendingFor(tab)).toEqual([]);
  });

  it('boundary 1 — crash before settlement: the obligation exists, the attempt is still open, nothing is credited', async () => {
    const tab = await openTab();
    const attemptId = startLessonAttempt(tab);
    expect(tab.pending.registerPendingCompletion(attemptId, LESSON_NODE)).toBe(true); // step 1 only
    // The dying page's exit path (pagehide / unmount) settles its open attempt as abandoned: no win exists,
    // so the obligation is invalid and removed. An unfinished lesson earns nothing.
    tab.attempts.settleJourneyAttempt(attemptId, 'abandoned');
    const reloaded = await openTab();
    expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 1, pending: 0 });
    expect(completedIds(reloaded)).toEqual([]);
    expect(attemptOf(reloaded, attemptId)?.outcome).toBe('abandoned');
  });

  it('boundary 1b — while the attempt is still in flight, recovery leaves the obligation alone and credits nothing', async () => {
    const tab = await openTab();
    const attemptId = startLessonAttempt(tab);
    tab.pending.registerPendingCompletion(attemptId, LESSON_NODE);
    expect(tab.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 0, pending: 1 });
    expect(completedIds(tab)).toEqual([]);
  });

  it('boundary 2 — crash after settlement: the next load applies the completion exactly once', async () => {
    const tab = await openTab();
    owedLessonWin(tab);
    expect(completedIds(tab)).toEqual([]);
    const reloaded = await openTab();
    expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 });
    expect(completedIds(reloaded)).toEqual([LESSON_NODE]);
    expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 0, pending: 0 }); // repeated recovery
    expect(completedIds(reloaded)).toEqual([LESSON_NODE]);
  });

  it('boundary 3 — crash after progress was applied, before the obligation was removed: recovery only cleans up', async () => {
    const tab = await openTab();
    owedLessonWin(tab);
    complete(tab, [LESSON_NODE]); // step 3 landed
    const before = JSON.stringify(tab.storage.loadJourneyProgress());
    expect(pendingFor(tab)).toHaveLength(1); // step 4 never ran
    const reloaded = await openTab();
    expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 0, cleared: 1, pending: 0 });
    expect(JSON.stringify(reloaded.storage.loadJourneyProgress())).toBe(before); // not applied twice, not rewritten
  });

  it('repeated recovery and repeated trail mounts are idempotent', async () => {
    const tab = await openTab();
    complete(tab, PRIOR_OF_SECOND_LESSON);
    owedLessonWin(tab, SECOND_LESSON_NODE);
    tab.mountTrail();
    tab.mountTrail();
    tab.recovery.recoverPendingJourneyCompletions();
    expect(completedIds(tab)).toEqual([...PRIOR_OF_SECOND_LESSON, SECOND_LESSON_NODE]);
    expect(pendingFor(tab)).toEqual([]);
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getJourneyNodeById } from './journeyChapters';
import { loadJourneyAttempts, settleJourneyAttempt, startJourneyAttempt } from './journeyAttempts';
import {
  abandonJourneyMatchAttempt,
  abandonStaleJourneyMatchAttempts,
  beginJourneyMatchAttempt,
  recordJourneyMatchOutcome,
} from './journeyMatchOutcome';
import { buildJourneyBotTrial } from './journeyLaunch';
import { loadJourneyProgress, markJourneyNodeCompleted } from './journeyStorage';
import { setJourneyStorageUser } from './journeyStorageScope';
import type { JourneyActiveChallenge } from './journeyRuntime';
import type { JourneyNodeWithStatus } from './journeyTypes';

const DOT = 'ch1-n02'; // Dot's Table — a match; unlocked once Read the Gate (ch1-n07) is done
const GATE = 'ch1-n07';
const BOSS = 'ch1-n10';

function challengeFor(nodeId: string): JourneyActiveChallenge {
  const node = getJourneyNodeById(nodeId)!;
  // The launch path only builds trials for playable stages; the status here is just "playable".
  const withStatus: JourneyNodeWithStatus = { ...node, status: 'unlocked' };
  const challenge = buildJourneyBotTrial(withStatus);
  if (!challenge) throw new Error(`no trial for ${nodeId}`);
  return challenge;
}

const completed = (nodeId: string) => loadJourneyProgress().chapters['ch1-fritz-trail'].completedNodeIds.includes(nodeId);

beforeEach(() => {
  window.localStorage.clear();
  setJourneyStorageUser(null);
  markJourneyNodeCompleted(GATE); // Dot's Table is now the current stage
});

describe('beginJourneyMatchAttempt', () => {
  it('starts an in-progress match attempt carrying the stage rules, and returns the challenge with its id', () => {
    const challenge = beginJourneyMatchAttempt(challengeFor(DOT));
    expect(challenge.attemptId).toMatch(/^jat_/);
    const [attempt] = loadJourneyAttempts();
    expect(attempt).toMatchObject({ attemptId: challenge.attemptId, nodeId: DOT, kind: 'match', outcome: 'in_progress' });
    expect(attempt.detail).toMatchObject({ rival: 'Dot', fritzTier: 'rookie', dealSize: 7, winningScore: 30, headStartYou: 0, headStartBot: 0, replay: false });
  });

  it('records the configured head start on the attempt', () => {
    const boss = challengeFor(BOSS);
    expect(boss.scoreHandicap).toEqual({ you: 15, bot: 0 });
    const started = beginJourneyMatchAttempt(boss);
    expect(loadJourneyAttempts().find((attempt) => attempt.attemptId === started.attemptId)?.detail).toMatchObject({
      rival: 'Fritz', fritzTier: 'elite', winningScore: 60, headStartYou: 15, headStartBot: 0,
    });
  });
});

describe('recording a match result at game over', () => {
  it('a win records the attempt AND completes the stage — without any navigation step', () => {
    const challenge = beginJourneyMatchAttempt(challengeFor(DOT));
    expect(completed(DOT)).toBe(false);
    const result = recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true, finalScore: { you: 30, bot: 18 } });
    expect(result).toEqual({ recorded: true, completedNode: true });
    expect(completed(DOT)).toBe(true);
    expect(loadJourneyAttempts()[0]).toMatchObject({ outcome: 'won', detail: expect.objectContaining({ finalYou: 30, finalBot: 18 }) });
  });

  it('a loss records a loss and does NOT complete the stage', () => {
    const challenge = beginJourneyMatchAttempt(challengeFor(DOT));
    expect(recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: false })).toEqual({ recorded: true, completedNode: false });
    expect(completed(DOT)).toBe(false);
    expect(loadJourneyAttempts()[0].outcome).toBe('lost');
  });

  it('duplicate game-over callbacks cannot duplicate the attempt or award completion twice', () => {
    const challenge = beginJourneyMatchAttempt(challengeFor(DOT));
    const input = { attemptId: challenge.attemptId!, nodeId: DOT, won: true };
    expect(recordJourneyMatchOutcome(input)).toEqual({ recorded: true, completedNode: true });
    const afterFirst = JSON.stringify(loadJourneyProgress().chapters);
    for (let index = 0; index < 4; index += 1) {
      expect(recordJourneyMatchOutcome(input)).toMatchObject({ recorded: false, completedNode: false });
    }
    expect(loadJourneyAttempts()).toHaveLength(1);
    expect(JSON.stringify(loadJourneyProgress().chapters)).toBe(afterFirst);
  });

  it('a late contradictory result cannot flip a recorded win into a loss (or the reverse)', () => {
    const won = beginJourneyMatchAttempt(challengeFor(DOT));
    recordJourneyMatchOutcome({ attemptId: won.attemptId!, nodeId: DOT, won: true });
    recordJourneyMatchOutcome({ attemptId: won.attemptId!, nodeId: DOT, won: false });
    expect(loadJourneyAttempts()[0].outcome).toBe('won');
    expect(completed(DOT)).toBe(true);
  });

  it('refuses an outcome whose attempt belongs to a different stage', () => {
    const challenge = beginJourneyMatchAttempt(challengeFor(DOT));
    expect(recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: 'ch1-n12', won: true })).toMatchObject({ recorded: false, completedNode: false });
    expect(completed('ch1-n12')).toBe(false);
    expect(loadJourneyAttempts()[0].outcome).toBe('in_progress');
  });

  it('refuses an outcome for an unknown attempt', () => {
    expect(recordJourneyMatchOutcome({ attemptId: 'jat_nope', nodeId: DOT, won: true })).toMatchObject({ recorded: false, completedNode: false });
    expect(completed(DOT)).toBe(false);
  });

  it('records a win on a still-locked stage but never completes it', () => {
    // Boss is locked: nothing before it is complete.
    const attempt = startJourneyAttempt({ nodeId: BOSS, kind: 'match' });
    expect(recordJourneyMatchOutcome({ attemptId: attempt.attemptId, nodeId: BOSS, won: true })).toEqual({ recorded: true, completedNode: false });
    expect(completed(BOSS)).toBe(false);
  });

  it('survives a reload: the recorded win and the completion are both still there', async () => {
    const challenge = beginJourneyMatchAttempt(challengeFor(DOT));
    recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true });
    vi.resetModules();
    const attempts = await import('./journeyAttempts');
    const storage = await import('./journeyStorage');
    expect(attempts.loadJourneyAttempts().map((attempt) => attempt.outcome)).toEqual(['won']);
    expect(storage.loadJourneyProgress().chapters['ch1-fritz-trail'].completedNodeIds).toContain(DOT);
  });
});

describe('rematch, replay and abandonment', () => {
  it('a rematch after a loss is a new attempt with the same stage rules and head start; the stage is still open', () => {
    const first = beginJourneyMatchAttempt(challengeFor(BOSS));
    recordJourneyMatchOutcome({ attemptId: first.attemptId!, nodeId: BOSS, won: false });
    const second = beginJourneyMatchAttempt(first); // what a rematch does: same challenge, fresh attempt
    expect(second.attemptId).not.toBe(first.attemptId);
    expect(second).toMatchObject({ nodeId: BOSS, fritzTier: 'elite', winningScore: 60, scoreHandicap: { you: 15, bot: 0 } });
    const [lost, open] = loadJourneyAttempts();
    expect(lost.outcome).toBe('lost');
    expect(open).toMatchObject({ outcome: 'in_progress', detail: expect.objectContaining({ headStartYou: 15 }) });
  });

  it('a rematch after a win is a distinct replay attempt and cannot undo the completion', () => {
    const first = beginJourneyMatchAttempt(challengeFor(DOT));
    recordJourneyMatchOutcome({ attemptId: first.attemptId!, nodeId: DOT, won: true });
    expect(completed(DOT)).toBe(true);

    const replay = beginJourneyMatchAttempt(first);
    expect(loadJourneyAttempts().find((attempt) => attempt.attemptId === replay.attemptId)?.detail.replay).toBe(true);
    recordJourneyMatchOutcome({ attemptId: replay.attemptId!, nodeId: DOT, won: false });
    expect(completed(DOT)).toBe(true); // a replay loss changes nothing
    expect(loadJourneyAttempts().map((attempt) => attempt.outcome)).toEqual(['won', 'lost']);
  });

  it('a replay win records an attempt but changes no progress', () => {
    const first = beginJourneyMatchAttempt(challengeFor(DOT));
    recordJourneyMatchOutcome({ attemptId: first.attemptId!, nodeId: DOT, won: true });
    const before = JSON.stringify(loadJourneyProgress().chapters);
    const replay = beginJourneyMatchAttempt(first);
    expect(recordJourneyMatchOutcome({ attemptId: replay.attemptId!, nodeId: DOT, won: true })).toEqual({ recorded: true, completedNode: false });
    expect(JSON.stringify(loadJourneyProgress().chapters)).toBe(before);
  });

  it('leaving without a result abandons the attempt and awards nothing', () => {
    const challenge = beginJourneyMatchAttempt(challengeFor(DOT));
    expect(abandonJourneyMatchAttempt(challenge.attemptId)).toBe(true);
    expect(completed(DOT)).toBe(false);
    expect(loadJourneyAttempts()[0].outcome).toBe('abandoned');
    // a game-over callback arriving after the exit cannot award it either
    expect(recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true })).toMatchObject({ recorded: false, completedNode: false });
    expect(completed(DOT)).toBe(false);
  });

  it('leaving after a recorded result leaves that result alone', () => {
    const challenge = beginJourneyMatchAttempt(challengeFor(DOT));
    recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true });
    expect(abandonJourneyMatchAttempt(challenge.attemptId)).toBe(false);
    expect(loadJourneyAttempts()[0].outcome).toBe('won');
    expect(completed(DOT)).toBe(true);
  });

  it('tolerates a missing attempt id', () => {
    expect(abandonJourneyMatchAttempt(undefined)).toBe(false);
    expect(abandonJourneyMatchAttempt(null)).toBe(false);
  });

  it('a tab closed or refreshed mid-match never awards a win', async () => {
    const challenge = beginJourneyMatchAttempt(challengeFor(DOT));
    window.dispatchEvent(new Event('pagehide')); // reload / close
    vi.resetModules(); // the page is gone; its match state with it
    const attempts = await import('./journeyAttempts');
    const storage = await import('./journeyStorage');
    expect(attempts.loadJourneyAttempts().map((attempt) => attempt.outcome)).toEqual(['abandoned']);
    expect(storage.loadJourneyProgress().chapters['ch1-fritz-trail'].completedNodeIds).not.toContain(DOT);
    expect(challenge.attemptId).toBeTruthy();
  });

  it('reaching the trail settles a match that was left by browser back or a swipe (no exit handler ran) as abandoned', () => {
    // A live match and the trail screen are never mounted together, so any open match attempt is dead
    // by the time the trail mounts — even one still "live" in this page's memory.
    const challenge = beginJourneyMatchAttempt(challengeFor(DOT));
    const lesson = startJourneyAttempt({ nodeId: GATE, kind: 'lesson' });
    expect(abandonStaleJourneyMatchAttempts()).toBe(1);
    const byId = Object.fromEntries(loadJourneyAttempts().map((attempt) => [attempt.attemptId, attempt.outcome]));
    expect(byId[challenge.attemptId!]).toBe('abandoned');
    expect(byId[lesson.attemptId]).toBe('in_progress'); // only matches are settled here
    expect(completed(DOT)).toBe(false);
    // and a result arriving after that can no longer award anything
    expect(recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true })).toMatchObject({ recorded: false, completedNode: false });
    expect(abandonStaleJourneyMatchAttempts()).toBe(0);
  });

  it('leaves recorded results alone when sweeping stale match attempts', () => {
    const won = beginJourneyMatchAttempt(challengeFor(DOT));
    recordJourneyMatchOutcome({ attemptId: won.attemptId!, nodeId: DOT, won: true });
    expect(abandonStaleJourneyMatchAttempts()).toBe(0);
    expect(loadJourneyAttempts()[0].outcome).toBe('won');
  });

  it('does not let one account\'s result touch another account\'s progress', () => {
    setJourneyStorageUser('user-a');
    markJourneyNodeCompleted(GATE);
    const challenge = beginJourneyMatchAttempt(challengeFor(DOT));
    setJourneyStorageUser('user-b');
    markJourneyNodeCompleted(GATE);
    expect(recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true })).toMatchObject({ recorded: false, completedNode: false });
    expect(completed(DOT)).toBe(false);
    setJourneyStorageUser('user-a');
    expect(loadJourneyAttempts()[0].outcome).toBe('in_progress');
    expect(settleJourneyAttempt(challenge.attemptId!, 'abandoned').changed).toBe(true);
  });
});

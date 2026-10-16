import { describe, expect, it } from 'vitest';
import {
  createLifecycleHiddenTracker,
  evaluateLifecycleResumeResync,
  LIFECYCLE_HIDDEN_RESYNC_MS,
  LIFECYCLE_SUSPEND_GAP_MS,
  type LifecycleResumeInput,
} from './multiplayerLifecycleRecovery';

const base = (over: Partial<LifecycleResumeInput>): LifecycleResumeInput => ({
  now: 0,
  hiddenSinceMs: null,
  roomCode: 'ROOM1',
  matchStarted: true,
  recoveryState: 'idle',
  socketConnected: true,
  resyncInFlight: false,
  rejoinInFlight: false,
  intentionalDisconnect: false,
  lastLifecycleResyncAtMs: 0,
  ...over,
});

/** Replays what a Capacitor WKWebView was observed to do: JS is suspended while hidden, and the hidden transition is only
 *  delivered at resume together with focus / pageshow / visibilitychange(visible). */
describe('native suspension: the resume decision must not depend on a hide event delivered before suspension', () => {
  const T0 = 1_000_000;

  it('web order (hide event before the gap): resyncs after a long hide', () => {
    const tracker = createLifecycleHiddenTracker();
    tracker.markAlive(T0);
    tracker.markHidden(T0 + 500);
    const resumeAt = T0 + 120_000;
    const decision = evaluateLifecycleResumeResync(base({ now: resumeAt, hiddenSinceMs: tracker.consumeHiddenSince(resumeAt) }));
    expect(decision).toEqual({ shouldResync: true, reason: 'hidden_stale' });
  });

  it('native order (hide delivered only AT resume): the heartbeat gap still proves a long suspension', () => {
    const tracker = createLifecycleHiddenTracker();
    for (let t = T0; t <= T0 + 3_000; t += 1_000) tracker.markAlive(t);       // last tick before the app was suspended
    const resumeAt = T0 + 3_000 + 5 * 60_000;                                 // five minutes later
    tracker.markHidden(resumeAt);                                             // blur(visibility=hidden) arrives now, late
    const since = tracker.consumeHiddenSince(resumeAt);
    expect(since).toBe(T0 + 3_000);
    expect(evaluateLifecycleResumeResync(base({ now: resumeAt, hiddenSinceMs: since }))).toEqual({ shouldResync: true, reason: 'hidden_stale' });
  });

  it('native order with NO hide event at all (only a resume): still resyncs', () => {
    const tracker = createLifecycleHiddenTracker();
    tracker.markAlive(T0);
    const resumeAt = T0 + 10 * 60_000;
    expect(evaluateLifecycleResumeResync(base({ now: resumeAt, hiddenSinceMs: tracker.consumeHiddenSince(resumeAt) })).shouldResync).toBe(true);
  });

  it('regression: without the heartbeat the same late-hide order read as "hidden_duration_short"', () => {
    const resumeAt = T0 + 10 * 60_000;
    // what the pre-fix tracker produced: hiddenSince stamped at resume
    expect(evaluateLifecycleResumeResync(base({ now: resumeAt, hiddenSinceMs: resumeAt }))).toEqual({ shouldResync: false, reason: 'hidden_duration_short' });
  });

  it('a short app switch does not resync (below the staleness threshold) and does not flap', () => {
    const tracker = createLifecycleHiddenTracker();
    tracker.markAlive(T0);
    const resumeAt = T0 + LIFECYCLE_HIDDEN_RESYNC_MS - 1_000;
    expect(evaluateLifecycleResumeResync(base({ now: resumeAt, hiddenSinceMs: tracker.consumeHiddenSince(resumeAt) })).shouldResync).toBe(false);
  });

  it('steady foreground use never looks suspended (ticks keep the gap under the threshold)', () => {
    const tracker = createLifecycleHiddenTracker();
    for (let t = T0; t < T0 + 600_000; t += 1_000) tracker.markAlive(t);
    expect(tracker.consumeHiddenSince(T0 + 600_000)).toBeNull();
  });

  it('a second resume right after does not inherit the previous suspension (state is consumed)', () => {
    const tracker = createLifecycleHiddenTracker();
    tracker.markAlive(T0);
    tracker.consumeHiddenSince(T0 + 10 * 60_000);
    expect(tracker.consumeHiddenSince(T0 + 10 * 60_000 + 1_000)).toBeNull();
  });

  it('the suspension threshold is shorter than the resync threshold, so a gap can never be the reason a short switch resyncs', () => {
    expect(LIFECYCLE_SUSPEND_GAP_MS).toBeLessThan(LIFECYCLE_HIDDEN_RESYNC_MS);
  });
});

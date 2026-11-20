import { describe, expect, it } from 'vitest';
import {
  EMPTY_HAND_VIEW,
  HAND_REVEAL_AUTO_CONTINUE_MS,
  HAND_REVEAL_OPEN_DELAY_MS,
  initialHandLifecycleState,
  classifyReadyAck,
  readyRetryDelayMs,
  reduceHandLifecycle,
  stepsForViewChange,
  type HandLifecycleEffect,
  type HandLifecycleEvent,
  type HandLifecycleState,
  type HandView,
} from './handLifecycleMachine';

const view = (over: Partial<HandView> = {}): HandView => ({
  ...EMPTY_HAND_VIEW,
  inGame: true,
  hand: { handNumber: 2, handOver: true, gameOver: false, version: 1 },
  roomJoined: true,
  socketId: 1,
  connectionKey: 'c1',
  socketConnected: true,
  ...over,
});
const over = (handNumber: number, version = 1): HandView['hand'] => ({ handNumber, handOver: true, gameOver: false, version });
const playing = (handNumber: number, version = 1): HandView['hand'] => ({ handNumber, handOver: false, gameOver: false, version });
const reveal = (handNumber: number, version = 1): HandView['reveal'] => ({ handNumber, version });

/** Feeds events through the reducer, like the driver does when the refs agree with the machine. */
function run(events: HandLifecycleEvent[], seed: Partial<HandLifecycleState> = {}) {
  let state = initialHandLifecycleState(seed);
  const effects: HandLifecycleEffect[] = [];
  let previous: HandView | null = null;
  for (const event of events) {
    const step = reduceHandLifecycle(state, event.type === 'view' && !event.steps ? { ...event, steps: stepsForViewChange(previous, event.view) } : event);
    if (event.type === 'view') previous = event.view;
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}
const types = (effects: HandLifecycleEffect[]) => effects.map((effect) => effect.type);
const sent = (effects: HandLifecycleEffect[]) => effects.filter((effect) => effect.type === 'sendReady');

describe('arming the reveal (what the old arm effect did)', () => {
  it('arms the reveal timer when a hand ends, and not before the hand number is known', () => {
    const { effects } = run([{ type: 'view', view: view() }]);
    expect(effects).toContainEqual({ type: 'armRevealTimer', handNumber: 2, delayMs: HAND_REVEAL_OPEN_DELAY_MS });
    expect(sent(effects)).toEqual([]);
  });

  it('leaves the timer running when the same hand is echoed (a state echo must not cancel or re-arm it)', () => {
    const { effects } = run([
      { type: 'view', view: view() },
      { type: 'view', view: view({ hand: over(2, 2) }) },
    ]);
    expect(effects.filter((effect) => effect.type === 'armRevealTimer')).toHaveLength(1);
    expect(types(effects)).not.toContain('cancelRevealTimer');
  });

  it('cancels a pending reveal when the hand is no longer over', () => {
    const { effects } = run([
      { type: 'view', view: view() },
      { type: 'view', view: view({ hand: playing(3, 2) }) },
    ]);
    expect(types(effects)).toContain('cancelRevealTimer');
  });

  it('does not arm for a finished game or during a pre-game draw', () => {
    expect(types(run([{ type: 'view', view: view({ hand: { handNumber: 2, handOver: true, gameOver: true, version: 1 } }) }]).effects)).not.toContain('armRevealTimer');
    expect(types(run([{ type: 'view', view: view({ preGameDraw: true }) }]).effects)).not.toContain('armRevealTimer');
  });

  it('opens the reveal when its timer fires', () => {
    const { effects } = run([{ type: 'view', view: view() }, { type: 'revealTimerFired', handNumber: 2 }]);
    expect(effects).toContainEqual({ type: 'openReveal', handNumber: 2 });
  });
});

describe('being ready (what the old recovery effect and the continue path did)', () => {
  it('does not signal ready on the first view of a live hand end: the reveal has not opened (#490)', () => {
    expect(sent(run([{ type: 'view', view: view() }]).effects)).toEqual([]);
  });

  it('signals ready once, from the continue, for the hand the reveal is for', () => {
    const { effects } = run([
      { type: 'view', view: view() },
      { type: 'revealTimerFired', handNumber: 2 },
      { type: 'view', view: view({ reveal: reveal(2) }) },
      { type: 'continue' },
    ]);
    expect(sent(effects)).toEqual([{ type: 'sendReady', handNumber: 2, source: 'continue' }]);
    expect(types(effects)).toContain('closeReveal');
  });

  it('the countdown continues by itself, and any change to the reveal restarts it', () => {
    const { effects } = run([
      { type: 'view', view: view() },
      { type: 'view', view: view({ reveal: reveal(2, 1) }) },
      { type: 'view', view: view({ reveal: reveal(2, 2) }) },
    ]);
    expect(effects.filter((effect) => effect.type === 'armAutoContinue')).toEqual([
      { type: 'armAutoContinue', durationMs: HAND_REVEAL_AUTO_CONTINUE_MS },
      { type: 'armAutoContinue', durationMs: HAND_REVEAL_AUTO_CONTINUE_MS },
    ]);
  });

  it('re-signals once when the reveal was shown and cleared without a signal (a reconnect clears the modal)', () => {
    const { effects } = run([
      { type: 'view', view: view() },
      { type: 'revealTimerFired', handNumber: 2 },
      { type: 'view', view: view({ reveal: reveal(2) }) },
      { type: 'view', view: view({ reveal: null }) },
      { type: 'view', view: view({ reveal: null, hand: over(2, 2) }) },
    ]);
    expect(sent(effects)).toEqual([{ type: 'sendReady', handNumber: 2, source: 'recovery' }]);
  });

  it('does not signal while the reveal is still waiting to open', () => {
    const { effects } = run([{ type: 'view', view: view() }], { armedFor: 2, revealTimerPending: true });
    expect(sent(effects)).toEqual([]);
  });

  it('closes a reveal for an earlier hand once a later hand is in play, signalling nothing', () => {
    const { effects } = run([{ type: 'view', view: view({ hand: playing(3), reveal: reveal(2) }) }]);
    expect(types(effects)).toContain('closeReveal');
    expect(sent(effects)).toEqual([]);
  });

  it('keeps the reveal for the hand that is still over', () => {
    expect(types(run([{ type: 'view', view: view({ reveal: reveal(2) }) }]).effects)).not.toContain('closeReveal');
  });
});

describe('what the fuzzer found (handLifecycleFuzz.test.ts)', () => {
  it('P1: a reconnect inside the 1.4 s window does not signal ready for a reveal the player never saw', () => {
    const { effects } = run([
      { type: 'view', view: view() }, // hand ends, reveal armed
      { type: 'view', view: view({ inGame: false, socketConnected: false }) }, // the connection drops: the pending reveal is cancelled
      { type: 'view', view: view({ socketId: 2 }) }, // reconnected, inside the window
    ]);
    expect(sent(effects)).toEqual([]);
    // and the reveal is armed again, so the player does see it
    expect(effects.filter((effect) => effect.type === 'armRevealTimer')).toHaveLength(2);
  });

  it('P2: a second timer for a hand whose reveal has opened does not open it again, and it is not armed again', () => {
    const { effects } = run([
      { type: 'view', view: view() },
      { type: 'revealTimerFired', handNumber: 2 }, // the first timer opens it
      { type: 'view', view: view({ reveal: reveal(2) }) },
      { type: 'continue' }, // the player continues
      { type: 'view', view: view({ reveal: null }) },
      { type: 'revealTimerFired', handNumber: 2 }, // a leftover timer for the same hand
    ]);
    expect(effects.filter((effect) => effect.type === 'openReveal')).toHaveLength(1);
  });

  it('P2: a hand whose reveal opened while the connection was down is not armed again on reconnect', () => {
    const { effects } = run([
      { type: 'view', view: view() },
      { type: 'view', view: view({ inGame: false, socketConnected: false }) },
      { type: 'revealTimerFired', handNumber: 2 }, // the timer the cancel could not reach
      { type: 'view', view: view({ reveal: null, inGame: false, socketConnected: false }) },
      { type: 'view', view: view({ socketId: 2 }) },
    ]);
    expect(effects.filter((effect) => effect.type === 'armRevealTimer')).toHaveLength(1);
  });

  it('P5: a ready sent on a connection that has since dropped is sent again on the new one', () => {
    const { effects } = run([
      { type: 'view', view: view() },
      { type: 'revealTimerFired', handNumber: 2 },
      { type: 'view', view: view({ reveal: reveal(2) }) },
      { type: 'continue' },
      { type: 'view', view: view({ reveal: null }) },
      { type: 'view', view: view({ reveal: null, inGame: false, socketConnected: false }) },
      { type: 'view', view: view({ reveal: null, socketId: 2 }) },
    ]);
    expect(sent(effects)).toEqual([
      { type: 'sendReady', handNumber: 2, source: 'continue' },
      { type: 'sendReady', handNumber: 2, source: 'recovery' },
    ]);
  });

  it('P5: an acknowledged ready is not sent again on the same connection, even when the view is rebuilt', () => {
    const { effects } = run([
      { type: 'view', view: view() },
      { type: 'revealTimerFired', handNumber: 2 },
      { type: 'view', view: view({ reveal: reveal(2) }) },
      { type: 'continue' },
      { type: 'readySettled', handNumber: 2, source: 'continue', ok: true },
      { type: 'view', view: view({ reveal: null }) },
      { type: 'view', view: view({ reveal: null, socketId: 2 }) }, // a new socket object on the same connection
    ]);
    expect(sent(effects)).toEqual([{ type: 'sendReady', handNumber: 2, source: 'continue' }]);
  });

  it('after a reconnect an acknowledged ready is sent again (the server may have restarted and lost a mark it acknowledged before it was durable)', () => {
    // socket.io keeps the same socket object across a reconnect (socketId does not change); the connection (socket.id) does.
    const { effects } = run([
      { type: 'view', view: view() },
      { type: 'revealTimerFired', handNumber: 2 },
      { type: 'view', view: view({ reveal: reveal(2) }) },
      { type: 'continue' },
      { type: 'readySettled', handNumber: 2, source: 'continue', ok: true }, // acknowledged on c1
      { type: 'view', view: view({ reveal: null }) },
      { type: 'view', view: view({ reveal: null, connectionKey: null, socketConnected: false }) }, // the server goes away
      { type: 'view', view: view({ reveal: null, connectionKey: 'c2' }) }, // back, same socket object
    ]);
    expect(sent(effects)).toEqual([
      { type: 'sendReady', handNumber: 2, source: 'continue' },
      { type: 'sendReady', handNumber: 2, source: 'recovery' },
    ]);
  });

  it('the resend is acknowledged on the new connection and is not repeated until the next reconnect', () => {
    const { effects } = run([
      { type: 'view', view: view() },
      { type: 'revealTimerFired', handNumber: 2 },
      { type: 'view', view: view({ reveal: reveal(2) }) },
      { type: 'continue' },
      { type: 'readySettled', handNumber: 2, source: 'continue', ok: true, connectionKey: 'c1' },
      { type: 'view', view: view({ reveal: null }) },
      { type: 'view', view: view({ reveal: null, connectionKey: 'c2' }) },
      { type: 'readySettled', handNumber: 2, source: 'recovery', ok: true, connectionKey: 'c2' },
      { type: 'view', view: view({ reveal: null, connectionKey: 'c2', hand: over(2, 2) }) }, // an echo of the state
      { type: 'view', view: view({ reveal: null, connectionKey: 'c3' }) }, // and another reconnect
    ]);
    expect(sent(effects).map((e) => e.source)).toEqual(['continue', 'recovery', 'recovery']);
  });

  it('a reconnect does not resend for a hand that has moved on, nor before the reveal for it has been seen', () => {
    const moved = run([
      { type: 'view', view: view() },
      { type: 'revealTimerFired', handNumber: 2 },
      { type: 'view', view: view({ reveal: reveal(2) }) },
      { type: 'continue' },
      { type: 'readySettled', handNumber: 2, source: 'continue', ok: true },
      { type: 'view', view: view({ reveal: null, hand: playing(3), connectionKey: 'c2' }) },
    ]);
    expect(sent(moved.effects)).toEqual([{ type: 'sendReady', handNumber: 2, source: 'continue' }]);
    const unseen = run([
      { type: 'view', view: view() },
      { type: 'view', view: view({ connectionKey: 'c2' }) }, // reconnect inside the 1.4 s window: reveal not opened yet
    ]);
    expect(sent(unseen.effects)).toEqual([]);
  });

  it('P5: a ready that is never acknowledged is retried at once, not when something else changes', () => {
    const { effects } = run([
      { type: 'view', view: view() },
      { type: 'revealTimerFired', handNumber: 2 },
      { type: 'view', view: view({ reveal: reveal(2) }) },
      { type: 'continue' },
      { type: 'view', view: view({ reveal: null }) },
      { type: 'readySettled', handNumber: 2, source: 'continue', ok: false },
    ]);
    expect(sent(effects)).toEqual([
      { type: 'sendReady', handNumber: 2, source: 'continue' },
      { type: 'sendReady', handNumber: 2, source: 'recovery' },
    ]);
  });

  it('a failed recovery send warns and retries', () => {
    const { effects } = run([
      { type: 'view', view: view() },
      { type: 'revealTimerFired', handNumber: 2 },
      { type: 'view', view: view({ reveal: reveal(2) }) },
      { type: 'view', view: view({ reveal: null }) }, // cleared without a signal
      { type: 'readySettled', handNumber: 2, source: 'recovery', ok: false },
    ]);
    expect(types(effects)).toContain('warnReadyFailed');
    expect(sent(effects).filter((effect) => effect.type === 'sendReady' && effect.source === 'recovery')).toHaveLength(2);
  });
});

describe('stepsForViewChange: each decision runs only when the inputs its old effect depended on change', () => {
  it('runs everything on the first view', () => {
    expect(stepsForViewChange(null, view())).toEqual(['recovery', 'arm', 'superseded', 'autoContinue']);
  });

  it('a state echo of the same hand re-runs the arm and superseded decisions, not the recovery', () => {
    expect(stepsForViewChange(view(), view({ hand: over(2, 2) }))).toEqual(['arm', 'superseded']);
  });

  it('a new reveal object re-runs the recovery, superseded and countdown decisions', () => {
    expect(stepsForViewChange(view({ reveal: reveal(2, 1) }), view({ reveal: reveal(2, 2) }))).toEqual(['recovery', 'superseded', 'autoContinue']);
  });

  it('a new socket re-runs the recovery decision', () => {
    expect(stepsForViewChange(view(), view({ socketId: 2 }))).toEqual(['recovery']);
  });

  it('nothing changed: nothing runs', () => {
    expect(stepsForViewChange(view(), view())).toEqual([]);
  });
});

describe('a refused hand:ready (audit B1): resent with a backoff, not counted as acknowledged', () => {
  const toContinue: HandLifecycleEvent[] = [
    { type: 'view', view: view() },
    { type: 'revealTimerFired', handNumber: 2 },
    { type: 'view', view: view({ reveal: reveal(2) }) },
    { type: 'continue' },
    { type: 'view', view: view({ reveal: null }) },
  ];
  const refused: HandLifecycleEvent = { type: 'readySettled', handNumber: 2, source: 'continue', ok: false, refused: true };

  it('classifies the server answers', () => {
    expect(classifyReadyAck({ ok: true, started: true })).toBe('acked');
    expect(classifyReadyAck({ ok: false, error: 'stale_or_duplicate_hand_ready', ignored: true })).toBe('acked');
    expect(classifyReadyAck({ ok: false, error: 'stale_match', stale: true })).toBe('acked');
    expect(classifyReadyAck({ ok: false, uncertain: true, error: "Hand update couldn't be saved — try again." })).toBe('refused');
    expect(classifyReadyAck({ ok: false, error: 'new_hand_blocked' })).toBe('refused');
    expect(classifyReadyAck(undefined)).toBe('acked');
  });

  it('backs off 1 s, 2 s, 4 s, 8 s, then 15 s', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(readyRetryDelayMs)).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  });

  it('does not resend at once, and not on state echoes while waiting; the timer resends', () => {
    const { state, effects } = run([...toContinue, refused, { type: 'view', view: view({ reveal: null, hand: over(2, 2) }) }, { type: 'view', view: view({ reveal: null, hand: over(2, 3) }) }]);
    expect(sent(effects)).toEqual([{ type: 'sendReady', handNumber: 2, source: 'continue' }]);
    expect(effects).toContainEqual({ type: 'scheduleReadyRetry', handNumber: 2, delayMs: 1000 });
    const fired = reduceHandLifecycle(state, { type: 'readyRetryFired', handNumber: 2 });
    expect(sent(fired.effects)).toEqual([{ type: 'sendReady', handNumber: 2, source: 'recovery' }]);
  });

  it('a new socket object on the same connection during the backoff does not resend either (the recovery step runs, the backoff holds)', () => {
    const { effects } = run([...toContinue, refused, { type: 'view', view: view({ reveal: null, socketId: 2 }) }]);
    expect(sent(effects)).toEqual([{ type: 'sendReady', handNumber: 2, source: 'continue' }]);
  });

  it('doubles the wait on each consecutive refusal and warns on the third', () => {
    const { effects } = run([
      ...toContinue,
      refused,
      { type: 'readyRetryFired', handNumber: 2 },
      { ...refused, source: 'recovery' },
      { type: 'readyRetryFired', handNumber: 2 },
      { ...refused, source: 'recovery' },
    ]);
    expect(effects.filter((e) => e.type === 'scheduleReadyRetry').map((e) => (e as { delayMs: number }).delayMs)).toEqual([1000, 2000, 4000]);
    expect(effects.filter((e) => e.type === 'warnReadyRetrying')).toHaveLength(1);
    expect(sent(effects)).toHaveLength(3);
  });

  it('an acknowledgement ends the retries and resets the backoff', () => {
    const { state, effects } = run([...toContinue, refused, { type: 'readyRetryFired', handNumber: 2 }, { type: 'readySettled', handNumber: 2, source: 'recovery', ok: true, connectionKey: 'c1' }, { type: 'view', view: view({ reveal: null, hand: over(2, 2) }) }]);
    expect(sent(effects)).toHaveLength(2);
    expect(state.readyRefusals).toBe(0);
  });

  it('a reconnect during the backoff resends at once on the new connection', () => {
    const { effects } = run([...toContinue, refused, { type: 'view', view: view({ reveal: null, connectionKey: 'c2' }) }]);
    expect(sent(effects).map((e) => (e as { source: string }).source)).toEqual(['continue', 'recovery']);
  });

  it('stops scheduling after the cap (a reconnect still resends)', () => {
    const events: HandLifecycleEvent[] = [...toContinue];
    for (let i = 0; i < 25; i++) events.push({ ...refused, source: 'recovery' }, { type: 'readyRetryFired', handNumber: 2 });
    const { effects } = run(events);
    expect(effects.filter((e) => e.type === 'scheduleReadyRetry')).toHaveLength(20);
  });
});

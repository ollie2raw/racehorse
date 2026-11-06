import { describe, expect, it } from 'vitest';
import {
  EMPTY_HAND_VIEW,
  HAND_REVEAL_AUTO_CONTINUE_MS,
  HAND_REVEAL_OPEN_DELAY_MS,
  initialHandLifecycleState,
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

  it('P5: an acknowledged ready is not sent again on a new connection', () => {
    const { effects } = run([
      { type: 'view', view: view() },
      { type: 'revealTimerFired', handNumber: 2 },
      { type: 'view', view: view({ reveal: reveal(2) }) },
      { type: 'continue' },
      { type: 'readySettled', handNumber: 2, source: 'continue', ok: true },
      { type: 'view', view: view({ reveal: null, socketId: 2 }) },
    ]);
    expect(sent(effects)).toEqual([{ type: 'sendReady', handNumber: 2, source: 'continue' }]);
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

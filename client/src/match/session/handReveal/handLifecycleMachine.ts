/**
 * The multiplayer hand lifecycle as a pure state machine: when a hand ends, when its reveal opens, when the player is "ready" for the next
 * hand, and when a lost ready signal is re-sent.
 *
 * These decisions used to be five React effects in useHandRevealSequence, interleaved with timers and refs, so the only way to exercise
 * them was a rendered hook with fake timers and the only way to find a race (the next hand dealt under the previous hand's reveal, #490)
 * was to see it on a screen. Here they are `(state, event) => { state, effects }`: no React, no timers, no clock. The hook is an adapter
 * that turns what React and the socket tell it into events and runs the effects it gets back; the fuzzer drives the same reducer with a
 * virtual clock and a model of the server's ready gate.
 *
 * Behaviour is the hook's, unchanged. The order inside `view` is the order the effects were declared in, because React ran them in that
 * order on a commit and the decisions read each other's output (the arm step sets what the recovery step looks at on the next view).
 */

/** How long after the hand ends before the reveal opens (the board is left to settle first). */
export const HAND_REVEAL_OPEN_DELAY_MS = 1_400;
/** How long a reveal stays up before it continues by itself. */
export const HAND_REVEAL_AUTO_CONTINUE_MS = 4_000;

export type HandView = {
  /** Connected and in a room with a hand. */
  inGame: boolean;
  /** The match state, or null before one has arrived. `version` changes whenever the state object does (an echo of the same hand is a new object). */
  hand: { handNumber: number; handOver: boolean; gameOver: boolean; version: number } | null;
  /** A pre-game draw is in progress (nothing of the hand lifecycle applies). */
  preGameDraw: boolean;
  /** The reveal on screen: its hand, and a version that changes whenever the object changes (a tile sync restarts the countdown). */
  reveal: { handNumber: number; version: number } | null;
  /** The room code is set. */
  roomJoined: boolean;
  /** Which socket object is in use (null: none). A new connection object is a new id. */
  socketId: number | null;
  /** The socket is connected (what the recovery path checks). */
  socketConnected: boolean;
};

export type HandLifecycleState = {
  /** The hand the reveal was armed or shown for (the shown ref). It is set when the reveal is ARMED, not when it opens. */
  armedFor: number | null;
  /** The reveal timer is pending. */
  revealTimerPending: boolean;
  /** The hand whose hand:ready this session has sent. */
  readySentFor: number | null;
  /** A recovery send is latched, so it is not repeated while the conditions hold. */
  recoveryLatched: boolean;
  /** The reveal and gameOver the auto-continue was last armed for, so it restarts only when they change. */
  autoContinueFor: { handNumber: number; version: number } | null;
  /** The latest view, for events that arrive without one (the auto-continue firing). */
  view: HandView;
};

/** The four decisions a view feeds, in the order they ran as effects. */
export type HandLifecycleStep = 'recovery' | 'arm' | 'superseded' | 'autoContinue';
const ALL_STEPS: readonly HandLifecycleStep[] = ['recovery', 'arm', 'superseded', 'autoContinue'];

export type HandLifecycleEvent =
  | { type: 'view'; view: HandView; steps?: readonly HandLifecycleStep[] }
  | { type: 'revealTimerFired'; handNumber: number }
  | { type: 'autoContinueFired' }
  | { type: 'continue' }
  | { type: 'readySettled'; handNumber: number | null; source: 'continue' | 'recovery'; ok: boolean };

export type HandLifecycleEffect =
  | { type: 'armRevealTimer'; handNumber: number; delayMs: number }
  | { type: 'cancelRevealTimer' }
  | { type: 'openReveal'; handNumber: number }
  | { type: 'closeReveal' }
  | { type: 'armAutoContinue'; durationMs: number }
  | { type: 'cancelAutoContinue' }
  | { type: 'sendReady'; handNumber: number | undefined; source: 'continue' | 'recovery' }
  | { type: 'warnReadyFailed' };

export const EMPTY_HAND_VIEW: HandView = {
  inGame: false,
  hand: null,
  preGameDraw: false,
  reveal: null,
  roomJoined: false,
  socketId: null,
  socketConnected: false,
};

export function initialHandLifecycleState(seed: Partial<HandLifecycleState> = {}): HandLifecycleState {
  return {
    armedFor: null,
    revealTimerPending: false,
    readySentFor: null,
    recoveryLatched: false,
    autoContinueFor: null,
    view: EMPTY_HAND_VIEW,
    ...seed,
  };
}

type Step = { state: HandLifecycleState; effects: HandLifecycleEffect[] };

/**
 * Which decisions to run for a new view. Each was an effect with its own dependency list, so it ran only when one of those inputs changed;
 * keeping that rule is what keeps behaviour identical (the recovery step in particular must not run on every echo of the state). The first
 * view runs all of them.
 */
export function stepsForViewChange(prev: HandView | null, next: HandView): HandLifecycleStep[] {
  if (!prev) return [...ALL_STEPS];
  const stateChanged = prev.hand?.version !== next.hand?.version;
  const revealChanged = prev.reveal?.version !== next.reveal?.version || prev.reveal?.handNumber !== next.reveal?.handNumber;
  const steps: HandLifecycleStep[] = [];
  if (
    prev.hand?.handOver !== next.hand?.handOver ||
    prev.hand?.gameOver !== next.hand?.gameOver ||
    prev.hand?.handNumber !== next.hand?.handNumber ||
    revealChanged ||
    prev.preGameDraw !== next.preGameDraw ||
    prev.roomJoined !== next.roomJoined ||
    prev.socketId !== next.socketId
  ) {
    steps.push('recovery');
  }
  if (prev.inGame !== next.inGame || stateChanged || prev.preGameDraw !== next.preGameDraw) steps.push('arm');
  if (revealChanged || stateChanged) steps.push('superseded');
  if (revealChanged || prev.hand?.gameOver !== next.hand?.gameOver) steps.push('autoContinue');
  return steps;
}

/** The hand number a ready signal is for: the reveal's, else the state's. */
function readyHandNumber(view: HandView): number | undefined {
  return view.reveal?.handNumber ?? view.hand?.handNumber;
}

/** Recover a hand:ready that never went out: only once the reveal for this hand has been armed, has opened and is gone again. */
function recoveryStep(state: HandLifecycleState, view: HandView, effects: HandLifecycleEffect[]): HandLifecycleState {
  const hand = view.hand;
  const needsReady =
    Boolean(hand?.handOver) &&
    !hand?.gameOver &&
    !view.reveal &&
    !view.preGameDraw &&
    state.armedFor === hand?.handNumber &&
    !state.revealTimerPending &&
    state.readySentFor !== hand?.handNumber &&
    view.roomJoined &&
    view.socketConnected;
  if (!needsReady) return state.recoveryLatched ? { ...state, recoveryLatched: false } : state;
  if (state.recoveryLatched) return state;
  effects.push({ type: 'sendReady', handNumber: hand?.handNumber, source: 'recovery' });
  return { ...state, recoveryLatched: true, readySentFor: hand?.handNumber ?? null };
}

/** Arm the reveal for a hand that is over; cancel a pending one when the hand is no longer over. */
function armStep(state: HandLifecycleState, view: HandView, effects: HandLifecycleEffect[]): HandLifecycleState {
  const hand = view.hand;
  let next = state;
  const cancelPending = () => {
    if (next.revealTimerPending) {
      effects.push({ type: 'cancelRevealTimer' });
      next = { ...next, revealTimerPending: false };
    }
  };
  // Leaving hand-over (or the game) genuinely invalidates a pending reveal.
  if (!view.inGame || !hand || hand.gameOver || !hand.handOver || view.preGameDraw) {
    cancelPending();
    return next;
  }
  // Already armed (or shown) for this hand: the state echo case. The timer is left running.
  if (next.armedFor === hand.handNumber) return next;
  next = { ...next, armedFor: hand.handNumber };
  cancelPending();
  effects.push({ type: 'armRevealTimer', handNumber: hand.handNumber, delayMs: HAND_REVEAL_OPEN_DELAY_MS });
  return { ...next, revealTimerPending: true };
}

/** A reveal belongs to the hand that just ended: once a later hand is in play it must not stay on top of it. Nothing is sent. */
function supersededStep(view: HandView, effects: HandLifecycleEffect[]): void {
  const hand = view.hand;
  if (!view.reveal || !hand || hand.gameOver || hand.handOver) return;
  if (hand.handNumber > view.reveal.handNumber) effects.push({ type: 'closeReveal' });
}

/** The reveal continues by itself after a few seconds; any change to the reveal (or the game ending) restarts the countdown. */
function autoContinueStep(state: HandLifecycleState, view: HandView, effects: HandLifecycleEffect[]): HandLifecycleState {
  const gameOver = Boolean(view.hand?.gameOver);
  const want = view.reveal && !gameOver ? { handNumber: view.reveal.handNumber, version: view.reveal.version } : null;
  const had = state.autoContinueFor;
  const same = (want === null && had === null) || (want !== null && had !== null && want.handNumber === had.handNumber && want.version === had.version);
  if (same) return state;
  effects.push({ type: 'cancelAutoContinue' });
  if (want) effects.push({ type: 'armAutoContinue', durationMs: HAND_REVEAL_AUTO_CONTINUE_MS });
  return { ...state, autoContinueFor: want };
}

function continueStep(state: HandLifecycleState): Step {
  const view = state.view;
  const effects: HandLifecycleEffect[] = [];
  const handNumber = readyHandNumber(view);
  let next = state;
  if (view.socketId !== null && view.roomJoined) {
    next = { ...next, readySentFor: handNumber ?? null };
    effects.push({ type: 'sendReady', handNumber, source: 'continue' });
  }
  effects.push({ type: 'closeReveal' });
  return { state: next, effects };
}

export function reduceHandLifecycle(state: HandLifecycleState, event: HandLifecycleEvent): Step {
  switch (event.type) {
    case 'view': {
      const effects: HandLifecycleEffect[] = [];
      const steps = event.steps ?? ALL_STEPS;
      let next: HandLifecycleState = { ...state, view: event.view };
      // Canonical order, whatever the caller listed: the arm step sets what the recovery step reads on the next view.
      if (steps.includes('recovery')) next = recoveryStep(next, event.view, effects);
      if (steps.includes('arm')) next = armStep(next, event.view, effects);
      if (steps.includes('superseded')) supersededStep(event.view, effects);
      if (steps.includes('autoContinue')) next = autoContinueStep(next, event.view, effects);
      return { state: next, effects };
    }
    case 'revealTimerFired': {
      // Any timer that fires opens its reveal: a timer overwritten in the shared ref (the hand:ended handler arms its own) is still running.
      return {
        state: { ...state, revealTimerPending: false },
        effects: [{ type: 'openReveal', handNumber: event.handNumber }],
      };
    }
    case 'autoContinueFired':
    case 'continue':
      return continueStep(state);
    case 'readySettled': {
      if (event.ok) return { state, effects: [] };
      if (event.source === 'continue') {
        // Not sent after all: let the recovery try again.
        return {
          state: state.readySentFor === event.handNumber ? { ...state, readySentFor: null } : state,
          effects: [],
        };
      }
      return {
        state: { ...state, recoveryLatched: false, readySentFor: null },
        effects: [{ type: 'warnReadyFailed' }],
      };
    }
  }
}

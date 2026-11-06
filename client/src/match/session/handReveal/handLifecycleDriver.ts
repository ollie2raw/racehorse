/**
 * Runs the hand lifecycle machine against the refs it shares with the rest of the match code.
 *
 * Two of the machine's facts live in refs that other code also reads and writes (the hand:ended socket handler arms its own reveal timer and
 * marks the hand shown; the unmount cleanup clears the timer), so the refs stay the source of truth for those: they are copied into the
 * machine before each event and written back after it. No React, no timers of its own: the caller runs the effects (a hook with real
 * timers, the fuzzer with a virtual clock).
 */
import {
  initialHandLifecycleState,
  reduceHandLifecycle,
  type HandLifecycleEffect,
  type HandLifecycleEvent,
  type HandLifecycleState,
} from './handLifecycleMachine';

export type HandLifecycleRefs<TimerHandle> = {
  /** The hand the reveal was armed or shown for. */
  shown: { current: number | null };
  /** The pending reveal timer, if any. */
  timer: { current: TimerHandle | null };
  /** A recovery send is latched. */
  recoveryLatched: { current: boolean };
};

export type HandLifecycleDriver<Context> = {
  dispatch: (event: HandLifecycleEvent, context?: Context) => HandLifecycleEffect[];
  getState: () => HandLifecycleState;
  /** Replace the machine's view without running any step (the continue path reads the latest render, not the last effect). */
  setView: (view: HandLifecycleState['view']) => void;
};

export function createHandLifecycleDriver<TimerHandle, Context = undefined>(
  refs: HandLifecycleRefs<TimerHandle>,
  runEffect: (effect: HandLifecycleEffect, context: Context | undefined) => void,
): HandLifecycleDriver<Context> {
  let machine = initialHandLifecycleState();
  return {
    dispatch(event, context) {
      const before: HandLifecycleState = {
        ...machine,
        armedFor: refs.shown.current,
        revealTimerPending: refs.timer.current !== null,
        recoveryLatched: refs.recoveryLatched.current,
      };
      const step = reduceHandLifecycle(before, event);
      machine = step.state;
      refs.shown.current = step.state.armedFor;
      refs.recoveryLatched.current = step.state.recoveryLatched;
      for (const effect of step.effects) runEffect(effect, context);
      // A timer that has fired (or was cancelled) is no longer pending: the ref says so too.
      if (!step.state.revealTimerPending) refs.timer.current = null;
      return step.effects;
    },
    getState: () => machine,
    setView: (view) => {
      machine = { ...machine, view };
    },
  };
}

/**
 * When to ask the room for its state because the server's turn clock and the match view disagree about whose turn it is.
 *
 * The clock and the match state are separate client stores. If the clock names this player and the view still says it is not their turn
 * (the state lagging or dropped), every tile stays dimmed until the deadline passes. Held for a short grace (a state update may be in
 * flight), the room is asked for its state once per deadline; the answer is the server's own state and moves. Nothing is ever played or
 * passed from here.
 *
 * Pure: the caller runs the timer the machine asks for and delivers its firing back as an event.
 */

/** How long the clock may name the player while the match view does not, before the room state is requested. */
export const TOURNAMENT_VIEW_DESYNC_GRACE_MS = 1_500;

export type DesyncInput = {
  /** A hand is being played and the match is not over. */
  active: boolean;
  /** The deadline of the clock that names this player, or null when the clock does not name them. */
  clockNamesMeDeadline: string | null;
  /** Whether the match view believes it is this player's turn. */
  viewIsMyTurn: boolean;
};

export type DesyncState = {
  /** The deadline already asked about, so it is asked once. */
  askedFor: string | null;
  /** The deadline the pending timer is for. */
  timerFor: string | null;
};

export type DesyncEvent = { type: 'input'; input: DesyncInput } | { type: 'timerFired'; deadline: string };

export type DesyncEffect =
  | { type: 'armTimer'; deadline: string; delayMs: number }
  | { type: 'cancelTimer' }
  | { type: 'requestState'; reason: 'tournament_clock_view_desync' };

export const INITIAL_DESYNC_STATE: DesyncState = { askedFor: null, timerFor: null };

export function reduceViewDesync(state: DesyncState, event: DesyncEvent): { state: DesyncState; effects: DesyncEffect[] } {
  if (event.type === 'timerFired') {
    if (state.timerFor !== event.deadline) return { state, effects: [] };
    return {
      state: { askedFor: event.deadline, timerFor: null },
      effects: [{ type: 'requestState', reason: 'tournament_clock_view_desync' }],
    };
  }
  const { active, clockNamesMeDeadline, viewIsMyTurn } = event.input;
  const effects: DesyncEffect[] = [];
  let next = state;
  // Any change of input starts the grace over.
  if (next.timerFor !== null) {
    effects.push({ type: 'cancelTimer' });
    next = { ...next, timerFor: null };
  }
  if (!active || !clockNamesMeDeadline || viewIsMyTurn) return { state: next, effects };
  if (next.askedFor === clockNamesMeDeadline) return { state: next, effects };
  effects.push({ type: 'armTimer', deadline: clockNamesMeDeadline, delayMs: TOURNAMENT_VIEW_DESYNC_GRACE_MS });
  return { state: { ...next, timerFor: clockNamesMeDeadline }, effects };
}

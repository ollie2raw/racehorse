import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { DailyFritzSetGameNumber } from './dailyFritzContracts.ts';

/** Server authority cursor — the client's view of official position in the run. */
export type DailyFritzAuthorityCursor = {
  gameNumber: DailyFritzSetGameNumber;
  handIndex: number;
  revision: number;
};

/**
 * Single source of truth for Daily Fritz in-match state.
 * Invariant (when coherent): match.handNumber === cursor.handIndex + 1
 */
export type DailyFritzMatchSession = {
  cursor: DailyFritzAuthorityCursor;
  match: BotMatchState;
};

export function isCoherentDailyFritzSession(session: DailyFritzMatchSession): boolean {
  return session.match.handNumber === session.cursor.handIndex + 1;
}

export type DailyFritzSessionAction =
  | { type: 'HYDRATE'; session: DailyFritzMatchSession }
  | { type: 'APPLY_ENGINE_RESULT'; match: BotMatchState }
  | {
      type: 'APPLY_NEXT_HAND';
      cursor: DailyFritzAuthorityCursor;
      match: BotMatchState;
    }
  | { type: 'APPLY_END_OF_RUN'; match: BotMatchState };

function assertCoherentNextHandSession(
  cursor: DailyFritzAuthorityCursor,
  match: BotMatchState,
): void {
  const session: DailyFritzMatchSession = { cursor, match };
  if (!isCoherentDailyFritzSession(session)) {
    throw new Error(
      `[daily-fritz-session] APPLY_NEXT_HAND produced incoherent session: `
      + `handIndex=${cursor.handIndex}, handNumber=${match.handNumber}`,
    );
  }
}

export function dailyFritzSessionReducer(
  state: DailyFritzMatchSession,
  action: DailyFritzSessionAction,
): DailyFritzMatchSession {
  switch (action.type) {
    case 'HYDRATE':
      return action.session;
    case 'APPLY_ENGINE_RESULT':
      return { ...state, match: action.match };
    case 'APPLY_NEXT_HAND':
      assertCoherentNextHandSession(action.cursor, action.match);
      return { cursor: action.cursor, match: action.match };
    case 'APPLY_END_OF_RUN':
      return { ...state, match: action.match };
    default:
      return state;
  }
}

export function assertDailyFritzSessionCoherent(
  session: DailyFritzMatchSession,
  context: string,
): void {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && !isCoherentDailyFritzSession(session)) {
    console.assert(
      false,
      `[daily-fritz-session] incoherent session at ${context}`,
      session,
    );
  }
}

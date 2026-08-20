import type { BotMatchState } from '../match/runtime/botEngine.ts';
import { createPreGameDrawShellMatch } from '../../match/preGameDraw/preGameDrawEligibility.ts';
import { createDailyFritzOfficialMatch } from './createDailyFritzOfficialMatch.ts';
import type { DailyFritzStartResponse } from './dailyFritzContracts.ts';
import type { DailyFritzPersistedSnapshot } from './dailyFritzSessionStorage.ts';
import type { DailyFritzAuthorityCursor, DailyFritzMatchSession } from './dailyFritzMatchSession.ts';

export type ResolveDailyFritzSessionInput = {
  dailyFritzPackage: DailyFritzStartResponse;
  winningScore: number;
  persistedSnapshot: DailyFritzPersistedSnapshot | null;
  preGameDrawEligible: boolean;
};

export function buildDailyFritzAuthorityCursor(
  dailyFritzPackage: DailyFritzStartResponse,
  persistedSnapshot: DailyFritzPersistedSnapshot | null,
): DailyFritzAuthorityCursor {
  const gameNumber = (dailyFritzPackage.current_game_number ?? 1) as DailyFritzAuthorityCursor['gameNumber'];
  const handIndex = typeof persistedSnapshot?.currentHandIndex === 'number'
    ? persistedSnapshot.currentHandIndex
    : dailyFritzPackage.current_hand_index ?? 0;
  const revision = persistedSnapshot?.authorityRevision
    ?? dailyFritzPackage.authority_revision
    ?? 0;
  return { gameNumber, handIndex, revision };
}

function resolveDailyFritzMatch(
  input: ResolveDailyFritzSessionInput,
): BotMatchState {
  const { dailyFritzPackage, winningScore, persistedSnapshot, preGameDrawEligible } = input;
  if (persistedSnapshot?.match) {
    return persistedSnapshot.match;
  }
  if (preGameDrawEligible) {
    return createPreGameDrawShellMatch(winningScore, dailyFritzPackage.deal_size);
  }
  return createDailyFritzOfficialMatch(dailyFritzPackage, winningScore);
}

/**
 * Build a coherent Daily Fritz session for bootstrap.
 * Pre-game draw shells may be temporarily incoherent (handNumber 0); persistence
 * skips checkpoints while the draw UI is active.
 */
export function resolveDailyFritzSession(
  input: ResolveDailyFritzSessionInput,
): DailyFritzMatchSession {
  const cursor = buildDailyFritzAuthorityCursor(
    input.dailyFritzPackage,
    input.persistedSnapshot,
  );
  const match = resolveDailyFritzMatch(input);
  return { cursor, match };
}

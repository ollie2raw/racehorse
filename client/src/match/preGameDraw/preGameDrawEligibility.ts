import type { BotDealSize } from '../../bot/botEngine.ts';
import type { BotMatchState } from '../../bot/botEngine.ts';

export type PreGameDrawMatchMode = 'bot' | 'ghost' | 'daily-fritz' | 'stakes';

export interface PreGameDrawEligibilityInput {
  mode: PreGameDrawMatchMode;
  dealSize: BotDealSize;
  isGuidedMode: boolean;
  isAuthoringMode: boolean;
  isAuthoringV2Mode: boolean;
  isGuidedV2Mode: boolean;
  isDailyFritzMode: boolean;
  hasPersistedDailyFritzMatch: boolean;
}

/**
 * Whether BotMatchScreen should run the pre-game tile draw before dealing hand 1.
 *
 * Gate rules (explicit — do not rely on createBotMatchWithStarter throw):
 * - dealSize must be 7 (14-tile deals need all 28 tiles; draw removes 2)
 * - mode must be standard Fritz bot or daily-fritz (ghost excluded)
 * - no scripted/fixed-deal paths (guided, authoring, resumed daily fritz)
 *
 * Daily Fritz also requires scripted draw fields on the start package; BotMatchScreen
 * applies that gate via `isDailyFritzScriptedDrawReady` before enabling the draw UI.
 */
export function isPreGameDrawEligible(input: PreGameDrawEligibilityInput): boolean {
  if (input.dealSize !== 7) return false;
  if (input.mode !== 'bot' && input.mode !== 'daily-fritz') return false;
  if (input.hasPersistedDailyFritzMatch) return false;
  if (input.isGuidedMode) return false;
  if (input.isAuthoringMode || input.isAuthoringV2Mode || input.isGuidedV2Mode) return false;
  return true;
}

/** Inert match shell shown while the pre-game draw UI is active (no dealt hands yet). */
export function createPreGameDrawShellMatch(
  winningScore: number,
  dealSize: BotDealSize,
): BotMatchState {
  return {
    players: {
      you: { hand: [], score: 0 },
      bot: { hand: [], score: 0 },
    },
    board: null,
    boneyard: [],
    deadTiles: [],
    handOpen: false,
    currentPlayer: 'you',
    consecutivePasses: 0,
    handNumber: 0,
    turnIndex: 0,
    handOver: true,
    gameOver: false,
    winnerId: null,
    winningScore,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize,
  };
}

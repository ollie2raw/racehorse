import type { MoveEntry } from '../../../game/moveLogger.ts';
import {
  createBotMatch,
  createFixedBotMatch,
  createFixedBotMatchWithStarter,
  type BotMatchState,
  type BotDealSize,
} from '../runtime/botEngine.ts';
import {
  generateAuthoringHandDeal,
  loadAuthoringSession,
  type FrozenLesson,
  type GuidedTranscript,
} from '../../../learn/guidedAuthoring.ts';
import { parseGuidedTranscriptState } from '../../guided/guidedBotMatchHelpers.ts';
import { resolveLessonV2InitialState } from './lessonV2LazyRegistry.ts';
import type { DailyFritzStartResponse } from '../../daily/dailyFritzContracts.ts';
import { createPreGameDrawShellMatch } from '../../../match/preGameDraw/preGameDrawEligibility.ts';
import type { LocalMatchMode } from '@racehorse/match-protocol';

export type ResolveInitialBotMatchStateInput = {
  mode: LocalMatchMode;
  winningScore: number;
  dealSize: BotDealSize;
  isAuthoringMode: boolean;
  isAuthoringV2Mode: boolean;
  isGuidedV2Mode: boolean;
  isGuidedMode: boolean;
  guidedTranscript: GuidedTranscript | null;
  frozenLesson: FrozenLesson | null;
  resumablePersistedDailyFritzMatch: {
    match: BotMatchState;
    movesUsed?: number;
    moveLog?: MoveEntry[];
  } | null;
  preGameDrawEligible: boolean;
  dailyFritzPackage: DailyFritzStartResponse | null;
  guidedInitSourceRef: { current: 'full-matchStateJson' | 'reduced-snapshot' | 'seeded-deal' | 'random' | null };
};

export function resolveInitialBotMatchState(input: ResolveInitialBotMatchStateInput): BotMatchState {
  const {
    mode,
    winningScore,
    dealSize,
    isAuthoringMode,
    isAuthoringV2Mode,
    isGuidedV2Mode,
    isGuidedMode,
    guidedTranscript,
    resumablePersistedDailyFritzMatch,
    preGameDrawEligible,
    dailyFritzPackage,
    guidedInitSourceRef,
  } = input;

  if (isAuthoringMode) {
    const saved = loadAuthoringSession();
    if (saved?.matchSnapshot) {
      try {
        return JSON.parse(saved.matchSnapshot) as BotMatchState;
      } catch {
        // fall through
      }
    }
    return createFixedBotMatch(generateAuthoringHandDeal(0), 60, 7);
  }

  if (isAuthoringV2Mode || isGuidedV2Mode) {
    return resolveLessonV2InitialState(input);
  }

  if (isGuidedMode && guidedTranscript) {
    const restored = parseGuidedTranscriptState(guidedTranscript.initialState);
    if (restored) {
      guidedInitSourceRef.current = 'full-matchStateJson';
      return restored;
    }
  }

  if (isGuidedMode && !guidedTranscript) {
    guidedInitSourceRef.current = 'seeded-deal';
    console.warn('[guided-init] source=seeded-deal — no explicit guided transcript found');
    return createFixedBotMatch(generateAuthoringHandDeal(0), winningScore, dealSize);
  }

  if (isGuidedMode && !input.frozenLesson) {
    guidedInitSourceRef.current = 'random';
    console.log('[guided-init] source=random (no frozen lesson found)');
    console.log('[guided-flow] initial coached board hydrated = false');
  }

  return (
    resumablePersistedDailyFritzMatch?.match
    ?? (preGameDrawEligible
      ? createPreGameDrawShellMatch(winningScore, dealSize)
      : mode === 'daily-fritz' && dailyFritzPackage
        ? (() => {
          const created = createFixedBotMatchWithStarter(
            dailyFritzPackage.first_hand,
            dailyFritzPackage.draw_winner === 'bot' ? 'bot' : 'you',
            winningScore,
            dealSize,
          );
          const scores = dailyFritzPackage.current_game_scores;
          return scores ? { ...created, players: { you: { ...created.players.you, score: scores.you }, bot: { ...created.players.bot, score: scores.fritz } } } : created;
        })()
        : createBotMatch(winningScore, dealSize))
  );
}

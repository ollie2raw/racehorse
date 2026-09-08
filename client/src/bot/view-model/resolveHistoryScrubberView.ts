import type { MatchHistoryScrubberState } from '../../modules/replay/index.ts';
import type { BoardState } from '../../types.ts';

export interface HistoryScrubberViewInput {
  scrubber: MatchHistoryScrubberState;
  liveBoard: BoardState | null;
  isGuidedMode: boolean;
  isAuthoringMode: boolean;
  isAuthoringV2Mode: boolean;
  isGuidedV2Mode: boolean;
  isJourneyTrial: boolean;
  isLessonLayoutMode: boolean;
  preGameDrawActive: boolean;
  gameOver: boolean;
}

export interface HistoryScrubberView {
  /** Whether the scrubber applies at all: solo PvF / Ghost / Daily Fritz, in play. */
  enabled: boolean;
  /** Enabled AND the cursor is parked on a past move. */
  viewingHistory: boolean;
  /** Board to render — the projected historical board while viewing, else the live board. */
  displayBoard: BoardState | null;
}

/**
 * Pure decision for the mid-match history scrubber on the bot match surface.
 * The scrubber is a solo-play affordance only — never during a guided lesson,
 * authoring, a journey trial, the lesson layout, the pre-game draw, or after
 * the game is over.
 */
export function resolveHistoryScrubberView(
  input: HistoryScrubberViewInput,
): HistoryScrubberView {
  const enabled =
    !input.isGuidedMode &&
    !input.isAuthoringMode &&
    !input.isAuthoringV2Mode &&
    !input.isGuidedV2Mode &&
    !input.isJourneyTrial &&
    !input.isLessonLayoutMode &&
    !input.preGameDrawActive &&
    !input.gameOver;

  const viewingHistory = enabled && input.scrubber.viewingHistory;

  return {
    enabled,
    viewingHistory,
    displayBoard: viewingHistory ? input.scrubber.historyBoard : input.liveBoard,
  };
}

import type { BotDealSize } from './primitives.ts';

/** Surface that launched the local match experience. */
export type LocalMatchMode = 'bot' | 'ghost' | 'daily-fritz' | 'stakes';

/** Optional overlays on top of a local match (learn, journey, ranked, etc.). */
export type MatchExperienceOverlay =
  | 'guided-v1'
  | 'guided-v2'
  | 'authoring-v1'
  | 'authoring-v2'
  | 'journey-trial'
  | 'ranked-pvf'
  | 'daily-puzzle-legacy'
  | 'guided-capture';

export type MatchCapabilities = {
  mode: LocalMatchMode;
  overlays: ReadonlySet<MatchExperienceOverlay>;
  dealSize: BotDealSize;
  winningScore: number;
  preGameDraw: boolean;
  postGameReview: boolean;
  verifiedRanking: boolean;
};

export function createMatchCapabilities(input: {
  mode: LocalMatchMode;
  overlays?: Iterable<MatchExperienceOverlay>;
  dealSize: BotDealSize;
  winningScore: number;
  preGameDraw?: boolean;
  postGameReview?: boolean;
  verifiedRanking?: boolean;
}): MatchCapabilities {
  return {
    mode: input.mode,
    overlays: new Set(input.overlays ?? []),
    dealSize: input.dealSize,
    winningScore: input.winningScore,
    preGameDraw: input.preGameDraw ?? false,
    postGameReview: input.postGameReview ?? true,
    verifiedRanking: input.verifiedRanking ?? false,
  };
}
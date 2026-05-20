export const GUIDED_MATCH_CANONICAL_VERSION = 1 as const;
export const GUIDED_MATCH_RECORDER_DRAFT_VERSION = 1 as const;
export const GUIDED_MATCH_RECORDER_DRAFT_KEY = 'racehorse:guided-match-recorder-draft:v1';

export type GuidedMatchOpponent = 'standard-fritz';
export type GuidedMatchActor = 'player' | 'fritz' | 'system';
export type GuidedMatchPlacementSide = 'left' | 'right';
export type GuidedMatchContinuedTurnReason = 'score' | 'double' | 'none' | 'hand-ended';
export type GuidedMatchCoachingTag =
  | 'best-move'
  | 'scoring'
  | 'tempo'
  | 'board-control'
  | 'double-management'
  | 'open-count'
  | 'boneyard-pressure'
  | 'defense';

export interface GuidedMatchTilePips {
  low: number;
  high: number;
}

export interface GuidedMatchPlacementTarget {
  side: GuidedMatchPlacementSide;
  branchId?: string | null;
  laneRef?: string | null;
}

export interface GuidedMatchLegalMoveMetadata {
  legalMovesBeforeCount: number;
  playableTileIdsBefore: string[];
  openTargetsBefore: string[];
}

export interface GuidedMatchCoachingContent {
  title: string;
  body: string;
  tags?: GuidedMatchCoachingTag[];
}

export interface GuidedMatchEventBase {
  id: string;
  kind: 'hand-start' | 'tile-play' | 'draw' | 'pass' | 'hand-end' | 'score-award' | 'next-hand';
  actor: GuidedMatchActor;
  handNumber: number;
  turnNumber: number;
  chainIndex: number;
  beforeSnapshot: string;
  afterSnapshot: string;
  openCountBefore: number;
  openCountAfter: number;
}

export interface GuidedMatchHandStartEvent extends GuidedMatchEventBase {
  kind: 'hand-start';
  actor: 'system';
  dealer: 'player' | 'fritz';
  boneyardCountAfterDeal: number;
}

export interface GuidedMatchTilePlayEvent extends GuidedMatchEventBase {
  kind: 'tile-play';
  actor: 'player' | 'fritz';
  tileId: string;
  tile: GuidedMatchTilePips;
  placement: GuidedMatchPlacementTarget;
  legalMoveMetadata: GuidedMatchLegalMoveMetadata;
  scored: boolean;
  pointsScored: number;
  continuedTurnReason: GuidedMatchContinuedTurnReason;
}

export interface GuidedMatchPlayerTilePlayEvent extends GuidedMatchTilePlayEvent {
  actor: 'player';
  coaching: GuidedMatchCoachingContent;
}

export interface GuidedMatchFritzTilePlayEvent extends GuidedMatchTilePlayEvent {
  actor: 'fritz';
  coaching?: never;
}

export interface GuidedMatchDrawEvent extends GuidedMatchEventBase {
  kind: 'draw';
  actor: 'player' | 'fritz';
  drawnTileId?: string;
  continuedTurnReason: GuidedMatchContinuedTurnReason;
}

export interface GuidedMatchPassEvent extends GuidedMatchEventBase {
  kind: 'pass';
  actor: 'player' | 'fritz';
  continuedTurnReason: GuidedMatchContinuedTurnReason;
}

export interface GuidedMatchHandEndEvent extends GuidedMatchEventBase {
  kind: 'hand-end';
  actor: 'system';
  winner: 'player' | 'fritz' | null;
  reason: 'domino' | 'blocked';
  pointsAwarded: number;
  pointsAwardedTo: 'player' | 'fritz' | null;
  scoredFrom: 'player' | 'fritz' | null;
  leftoverPips: number;
}

export interface GuidedMatchScoreAwardEvent extends GuidedMatchEventBase {
  kind: 'score-award';
  actor: 'system';
  awardedTo: 'player' | 'fritz';
  pointsAwarded: number;
  source: 'domino' | 'blocked' | 'hand-bonus';
}

export interface GuidedMatchNextHandEvent extends GuidedMatchEventBase {
  kind: 'next-hand';
  actor: 'system';
  nextHandNumber: number;
}

export type GuidedMatchEvent =
  | GuidedMatchHandStartEvent
  | GuidedMatchPlayerTilePlayEvent
  | GuidedMatchFritzTilePlayEvent
  | GuidedMatchDrawEvent
  | GuidedMatchPassEvent
  | GuidedMatchHandEndEvent
  | GuidedMatchScoreAwardEvent
  | GuidedMatchNextHandEvent;

export interface GuidedMatchLesson {
  version: typeof GUIDED_MATCH_CANONICAL_VERSION;
  lessonId: string;
  title: string;
  opponent: GuidedMatchOpponent;
  dealSize: number;
  targetScore: number;
  rootSeed: string;
  createdAt: string;
  updatedAt: string;
  initialMatchSnapshot: string;
  finalMatchSnapshot: string;
  events: GuidedMatchEvent[];
}

export interface GuidedMatchRecorderCursor {
  currentTurnNumber: number;
  currentChainIndex: number;
  eventCounter: number;
}

export interface GuidedMatchRecordedHandEnd {
  winner: 'you' | 'bot' | null;
  reason: 'domino' | 'blocked';
  pointsAwarded: number;
  loserPips: number;
  calcText: string;
}

export interface GuidedMatchRecorderDraft {
  version: typeof GUIDED_MATCH_RECORDER_DRAFT_VERSION;
  savedAt: string;
  lesson: GuidedMatchLesson;
  currentMatchSnapshot: string;
  cursor: GuidedMatchRecorderCursor;
  draftCoachingTitle?: string;
  draftCoachingBody?: string;
  draftCoachingTags?: string;
  pendingPlayerEvent: GuidedMatchPlayerTilePlayEvent | null;
  pendingPlayerHandEnded: GuidedMatchRecordedHandEnd | null;
  activeEventId: string | null;
  source: 'recorder';
}

import type {
  GuidedMatchCoachingContent,
  GuidedMatchDrawEvent,
  GuidedMatchFritzTilePlayEvent,
  GuidedMatchHandEndEvent,
  GuidedMatchHandStartEvent,
  GuidedMatchNextHandEvent,
  GuidedMatchPassEvent,
  GuidedMatchPlayerTilePlayEvent,
  GuidedMatchScoreAwardEvent,
} from './guidedMatchTypes';

export const GUIDED_MATCH_CANDIDATE_VERSION = 1 as const;
export const GUIDED_MATCH_CANDIDATES_STORAGE_KEY = 'racehorse:guided-match:candidates:v1';

export type GuidedMatchCandidateResult = 'won' | 'lost' | 'incomplete';
export type GuidedMatchCandidateOpponent = 'standard-fritz';
export type GuidedMatchCandidateFritzTier = 'standard';
export type GuidedMatchCandidateValidationStatus =
  | 'not-run'
  | 'draft-valid'
  | 'draft-with-issues'
  | 'final-valid'
  | 'final-with-issues';

export interface GuidedMatchCandidateStoredValidationIssue {
  path: string;
  message: string;
}

export interface GuidedMatchCandidateContinuityRepair {
  previousEventId: string;
  originalBeforeSnapshot: string;
}

export interface GuidedMatchCandidatePlayerTilePlayEvent
  extends Omit<GuidedMatchPlayerTilePlayEvent, 'coaching'> {
  coaching?: GuidedMatchCoachingContent;
}

export type GuidedMatchCandidateEvent =
  (
    | GuidedMatchHandStartEvent
    | GuidedMatchCandidatePlayerTilePlayEvent
    | GuidedMatchFritzTilePlayEvent
    | GuidedMatchDrawEvent
    | GuidedMatchPassEvent
    | GuidedMatchHandEndEvent
    | GuidedMatchScoreAwardEvent
    | GuidedMatchNextHandEvent
  ) & {
    captureContinuityRepair?: GuidedMatchCandidateContinuityRepair;
  };

export interface GuidedMatchCandidate {
  version: typeof GUIDED_MATCH_CANDIDATE_VERSION;
  candidateId: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  notes: string;
  opponent: GuidedMatchCandidateOpponent;
  fritzTier: GuidedMatchCandidateFritzTier;
  dealSize: 7;
  targetScore: 60;
  rootSeed: string | null;
  result: GuidedMatchCandidateResult;
  finalScore: {
    player: number;
    fritz: number;
  };
  eventCount: number;
  playerTileEventCount: number;
  handCount: number;
  initialMatchSnapshot: string;
  finalMatchSnapshot: string;
  events: GuidedMatchCandidateEvent[];
  validationStatus?: GuidedMatchCandidateValidationStatus;
  validationIssues?: GuidedMatchCandidateStoredValidationIssue[];
}

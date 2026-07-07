import type { GameState, Move, Tile } from '../../types';
import type { PreGameDrawState } from '../../match/preGameDraw/preGameDrawLogic';
import type { RoomEventMeta, StateUpdatePayload } from '../protocol';

export type ForcedDrawStaging =
  | {
      kind: 'self';
      youId: string;
      drawnCount: number;
      sequence: number;
      stagedHand: Tile[];
      pendingReveal: { sequence: number; fullHand: Tile[] };
      preDrawBoneyard: number;
    }
  | {
      kind: 'opponent';
      opponentId: string;
      drawnCount: number;
      sequence: number;
      stagedOpponentHandCount: number;
      boneyardDisplay: number;
    }
  | {
      kind: 'clear';
      rawBoneyardLength: number | null;
    };

export type SessionRefProjection = {
  isSeatedPlayerClear?: boolean;
  matchStarted?: boolean;
  playerReadyEmitted?: boolean;
  youId?: string;
  maxSequenceWatermark: number;
};

export type StateUpdateProjectionContext = {
  payload: StateUpdatePayload;
  maxSequenceWatermark: number;
  maxSequenceWatermarkBeforeMeta: number;
  youId: string;
  joinedRoom: string | null;
};

export type StateUpdateProjectionApply = {
  nextState: GameState | null;
  sessionRefs: SessionRefProjection;
  legalMoves: Move[];
  canDraw: boolean;
  preGameDraw: PreGameDrawState | null;
  forcedDrawStaging: ForcedDrawStaging;
  showRecoveryIdleHint: boolean;
  clearOpponentDisconnect: boolean;
  clearWaitingForReadyError: boolean;
  resyncAfterApply?: 'hand_identity_mismatch';
  autoPassPlayerIds: string[];
};

export type StateUpdateProjectionDropReason =
  | 'pre_projection_replay'
  | 'invalid_state_projection'
  | 'fresh_match_requires_sequence'
  | 'sequence_regression'
  | 'sequence_stale';

export type StateUpdateProjectionOutcome =
  | { kind: 'drop'; reason: StateUpdateProjectionDropReason; fetchReason?: string }
  | { kind: 'apply'; result: StateUpdateProjectionApply };

export type SpectateProjectionContext = {
  payload: { state?: GameState | null; eventMeta?: RoomEventMeta };
  maxSequenceWatermark: number;
  youId: string;
  joinedRoom: string | null;
};

export type SpectateProjectionApply = {
  nextState: GameState | null;
  sessionRefs: Pick<SessionRefProjection, 'isSeatedPlayerClear' | 'maxSequenceWatermark'>;
  showRecoveryIdleHint: boolean;
  forcedDrawStaging: Extract<ForcedDrawStaging, { kind: 'clear' }>;
};

export type SpectateProjectionDropReason =
  | 'spectator_in_roster'
  | 'invalid_spectator_snapshot'
  | 'sequence_regression'
  | 'sequence_stale';

export type SpectateProjectionOutcome =
  | { kind: 'drop'; reason: SpectateProjectionDropReason; fetchReason?: string }
  | { kind: 'apply'; result: SpectateProjectionApply };
import { describe, expect, it } from 'vitest';
import type { MoveEntry } from '../../game/moveLogger';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { correlateSnapshotsToMoveLog } from './correlateSnapshotsToMoveLog';

function makeMoveEntry(overrides: Partial<MoveEntry> & { moveNumber: number; player: 'you' | 'opponent' }): MoveEntry {
  return {
    action: 'place',
    tile: [1, 2],
    position: 'left',
    boardEnds: [1, 2],
    handBefore: [],
    validMoves: [],
    pipDelta: 0,
    pointsScored: 0,
    boardState: [],
    boardRenderState: null,
    handSnapshot: [],
    engineBestMove: null,
    ...overrides,
  };
}

function makeSnapshot(actionNumber: number, actorId: 'you' | 'bot'): ReviewPositionSnapshotV2 {
  return {
    snapshotVersion: 2,
    rulesVersion: 1,
    commandVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    stateDigestVersion: 1,
    identifiers: {
      sessionId: 'pvf-session-1',
      gameId: 'pvf-session-1',
      handId: 'hand-1',
      decisionId: `pvf-session-1:${actorId}:${actionNumber}`,
      mode: 'play-vs-fritz',
      gameNumber: 1,
      handNumber: 1,
      actionNumber,
      turnSequence: actionNumber,
      actorId,
      opponentId: actorId === 'you' ? 'bot' : 'you',
    },
    preAction: {
      board: null,
      actorHand: [],
      opponentTileCount: 7,
      boneyard: { physicalCount: 14, drawableCount: 14, deadCount: 0 },
      scores: { actor: 0, opponent: 0 },
      winningTarget: 60,
      consecutivePasses: 0,
      handOpen: true,
      knownMissingPipEvidence: [],
    },
    legalActions: [],
    actualAction: { kind: 'pass' },
    outcome: { immediatePoints: 0, postActionBoard: null, postActionActorScore: 0 },
    integrity: {
      authorityPreStateDigest: 'review-state-v1:00000000',
      authorityPostStateDigest: 'review-state-v1:11111111',
    },
  } as ReviewPositionSnapshotV2;
}

describe('correlateSnapshotsToMoveLog', () => {
  it('maps each snapshot decisionId to the moveLog entry sharing the same moveNumber/actionNumber, across an interleaved you/bot sequence', () => {
    const moveLog: MoveEntry[] = [
      makeMoveEntry({ moveNumber: 1, player: 'you', tile: [3, 4] }),
      makeMoveEntry({ moveNumber: 2, player: 'opponent', tile: [4, 5] }),
      makeMoveEntry({ moveNumber: 3, player: 'you', action: 'draw', tile: undefined }),
      makeMoveEntry({ moveNumber: 4, player: 'opponent', action: 'pass', tile: undefined }),
    ];
    const snapshots: ReviewPositionSnapshotV2[] = [
      makeSnapshot(1, 'you'),
      makeSnapshot(2, 'bot'),
      makeSnapshot(3, 'you'),
      makeSnapshot(4, 'bot'),
    ];

    const correlation = correlateSnapshotsToMoveLog(snapshots, moveLog);

    expect(correlation.size).toBe(4);
    expect(correlation.get('pvf-session-1:you:1')).toEqual(moveLog[0]);
    expect(correlation.get('pvf-session-1:bot:2')).toEqual(moveLog[1]);
    expect(correlation.get('pvf-session-1:you:3')).toEqual(moveLog[2]);
    expect(correlation.get('pvf-session-1:bot:4')).toEqual(moveLog[3]);
  });

  it('omits a snapshot from the correlation map, rather than mismatching it, when no moveLog entry shares its actionNumber', () => {
    // Simulates partial capture (e.g. review capture toggled mid-match) --
    // the recorder's actionNumber sequence and moveLog's moveNumber
    // sequence can drift out of parity; a snapshot with no matching
    // moveNumber must be dropped, never paired with the wrong entry.
    const moveLog: MoveEntry[] = [makeMoveEntry({ moveNumber: 1, player: 'you' })];
    const snapshots: ReviewPositionSnapshotV2[] = [makeSnapshot(1, 'you'), makeSnapshot(2, 'bot')];

    const correlation = correlateSnapshotsToMoveLog(snapshots, moveLog);

    expect(correlation.size).toBe(1);
    expect(correlation.get('pvf-session-1:you:1')).toEqual(moveLog[0]);
    expect(correlation.has('pvf-session-1:bot:2')).toBe(false);
  });

  it('returns an empty map for empty inputs', () => {
    expect(correlateSnapshotsToMoveLog([], []).size).toBe(0);
  });
});

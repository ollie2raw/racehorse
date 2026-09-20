import { describe, expect, it } from 'vitest';
import type { MoveEntry } from '../../game/moveLogger';
import type { ReviewAction, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { buildDecisionIdByMoveNumber, correlateSnapshotsToMoveLog } from './correlateSnapshotsToMoveLog';

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

function makeSnapshot(
  actionNumber: number,
  actorId: 'you' | 'bot',
  actualAction: ReviewAction = { kind: 'pass' },
): ReviewPositionSnapshotV2 {
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
    actualAction,
    outcome: { immediatePoints: 0, postActionBoard: null, postActionActorScore: 0 },
    integrity: {
      authorityPreStateDigest: 'review-state-v1:00000000',
      authorityPostStateDigest: 'review-state-v1:11111111',
    },
  } as ReviewPositionSnapshotV2;
}

function playAction(low: number, high: number, position: 'left' | 'right' = 'left'): ReviewAction {
  return { kind: 'play', tile: { low, high }, position };
}

describe('correlateSnapshotsToMoveLog', () => {
  it('maps each snapshot decisionId to the moveLog entry sharing the same moveNumber/actionNumber and matching actor/action content, across an interleaved you/bot sequence', () => {
    const moveLog: MoveEntry[] = [
      makeMoveEntry({ moveNumber: 1, player: 'you', tile: [3, 4] }),
      makeMoveEntry({ moveNumber: 2, player: 'opponent', tile: [4, 5] }),
      makeMoveEntry({ moveNumber: 3, player: 'you', action: 'draw', tile: undefined }),
      makeMoveEntry({ moveNumber: 4, player: 'opponent', action: 'pass', tile: undefined }),
    ];
    const snapshots: ReviewPositionSnapshotV2[] = [
      makeSnapshot(1, 'you', playAction(3, 4)),
      makeSnapshot(2, 'bot', playAction(4, 5)),
      makeSnapshot(3, 'you', { kind: 'draw' }),
      makeSnapshot(4, 'bot', { kind: 'pass' }),
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
    const moveLog: MoveEntry[] = [makeMoveEntry({ moveNumber: 1, player: 'you', tile: [3, 4] })];
    const snapshots: ReviewPositionSnapshotV2[] = [
      makeSnapshot(1, 'you', playAction(3, 4)),
      makeSnapshot(2, 'bot', { kind: 'pass' }),
    ];

    const correlation = correlateSnapshotsToMoveLog(snapshots, moveLog);

    expect(correlation.size).toBe(1);
    expect(correlation.get('pvf-session-1:you:1')).toEqual(moveLog[0]);
    expect(correlation.has('pvf-session-1:bot:2')).toBe(false);
  });

  it('returns an empty map for empty inputs', () => {
    expect(correlateSnapshotsToMoveLog([], []).size).toBe(0);
  });

  describe('content cross-check (correctness audit, 2026-09-19): actionNumber === moveNumber alone is not trusted', () => {
    it('rejects a counter match whose actualAction kind disagrees with the moveLog entry (fails safe, not confident)', () => {
      // actionNumber 1 and moveNumber 1 agree numerically, but the snapshot
      // says a tile was played while the logged entry says the player drew.
      // Before this fix, the bare counter match would have paired them
      // anyway. Now it must be omitted.
      const moveLog: MoveEntry[] = [makeMoveEntry({ moveNumber: 1, player: 'you', action: 'draw', tile: undefined })];
      const snapshots: ReviewPositionSnapshotV2[] = [makeSnapshot(1, 'you', playAction(3, 4))];

      const correlation = correlateSnapshotsToMoveLog(snapshots, moveLog);

      expect(correlation.size).toBe(0);
    });

    it('rejects a counter match whose played tile disagrees with the moveLog entry, even though both are "place" actions', () => {
      const moveLog: MoveEntry[] = [makeMoveEntry({ moveNumber: 1, player: 'you', tile: [3, 5] })];
      const snapshots: ReviewPositionSnapshotV2[] = [makeSnapshot(1, 'you', playAction(1, 5))];

      const correlation = correlateSnapshotsToMoveLog(snapshots, moveLog);

      expect(correlation.size).toBe(0);
    });

    it('rejects a counter match whose position disagrees with the moveLog entry, same tile', () => {
      const moveLog: MoveEntry[] = [makeMoveEntry({ moveNumber: 1, player: 'you', tile: [1, 5], position: 'left' })];
      const snapshots: ReviewPositionSnapshotV2[] = [makeSnapshot(1, 'you', playAction(1, 5, 'right'))];

      const correlation = correlateSnapshotsToMoveLog(snapshots, moveLog);

      expect(correlation.size).toBe(0);
    });

    it('accepts a played tile regardless of [low,high] order (tile identity, not tuple order)', () => {
      const moveLog: MoveEntry[] = [makeMoveEntry({ moveNumber: 1, player: 'you', tile: [5, 1] })];
      const snapshots: ReviewPositionSnapshotV2[] = [makeSnapshot(1, 'you', playAction(1, 5))];

      const correlation = correlateSnapshotsToMoveLog(snapshots, moveLog);

      expect(correlation.size).toBe(1);
    });

    it('rejects a counter match whose actor disagrees with the moveLog entry (you vs opponent)', () => {
      const moveLog: MoveEntry[] = [makeMoveEntry({ moveNumber: 1, player: 'opponent', tile: [3, 4] })];
      const snapshots: ReviewPositionSnapshotV2[] = [makeSnapshot(1, 'you', playAction(3, 4))];

      const correlation = correlateSnapshotsToMoveLog(snapshots, moveLog);

      expect(correlation.size).toBe(0);
    });
  });

  describe('multi-draw counter drift (correctness audit, 2026-09-19): the traced root cause', () => {
    // Reproduces the exact mechanism found in the audit: PVF's
    // resolveTranscriptDrawLogCount collapses every real multi-draw turn
    // into exactly one logged 'draw' MoveEntry, while
    // recordPlayerReviewDecision still fires once per real draw step. So a
    // 2-draw turn advances actionNumber by 2 but moveNumber by only 1,
    // permanently drifting the two counters apart for the rest of the
    // match.
    it('a 2-draw turn: the first draw still correlates (it is the real decision the collapsed entry represents); the second draw is honestly uncorrelated, never misattributed to the next real move', () => {
      const moveLog: MoveEntry[] = [
        makeMoveEntry({ moveNumber: 1, player: 'you', tile: [3, 4] }),
        makeMoveEntry({ moveNumber: 2, player: 'opponent', tile: [4, 5] }),
        // The whole 2-draw turn collapses into ONE MoveEntry (moveNumber 3),
        // built from the FIRST draw step's before-state -- see
        // resolveTranscriptDrawLogCount's doc comment.
        makeMoveEntry({ moveNumber: 3, player: 'you', action: 'draw', tile: undefined }),
        // The player's subsequent real play, now at moveNumber 4 -- one
        // behind where its actionNumber (5) would naively suggest.
        makeMoveEntry({ moveNumber: 4, player: 'you', tile: [1, 5] }),
      ];
      const snapshots: ReviewPositionSnapshotV2[] = [
        makeSnapshot(1, 'you', playAction(3, 4)),
        makeSnapshot(2, 'bot', playAction(4, 5)),
        // Draw step 1 of 2 -- actionNumber 3, correlates to moveNumber 3.
        makeSnapshot(3, 'you', { kind: 'draw' }),
        // Draw step 2 of 2 -- actionNumber 4. moveEntryByNumber.get(4) is
        // the REAL play (tile [1,5]), a 'place' entry -- the drift's first
        // casualty. Must NOT be silently attached to it.
        makeSnapshot(4, 'you', { kind: 'draw' }),
        // The real play decision -- actionNumber 5 (one ahead of its true
        // moveNumber, 4, because of the collapsed draw). No moveLog entry
        // exists at moveNumber 5 yet, so this is the pre-existing "no
        // counter match" case, not a content mismatch.
        makeSnapshot(5, 'you', playAction(1, 5)),
      ];

      const correlation = correlateSnapshotsToMoveLog(snapshots, moveLog);

      // Correctly correlated: the two opening plays, and draw-step-1 (which
      // really is the decision the collapsed entry represents).
      expect(correlation.get('pvf-session-1:you:1')).toEqual(moveLog[0]);
      expect(correlation.get('pvf-session-1:bot:2')).toEqual(moveLog[1]);
      expect(correlation.get('pvf-session-1:you:3')).toEqual(moveLog[2]);

      // The drift's casualties: honestly uncorrelated, not misattributed.
      expect(correlation.has('pvf-session-1:you:4')).toBe(false); // draw step 2 -- would have been silently glued to the [1,5] play
      expect(correlation.has('pvf-session-1:you:5')).toBe(false); // the real [1,5] play -- no counter match yet, same as today

      // The critical assertion: nothing in the correlation ever maps to
      // moveLog[3] (the real [1,5] play) -- its own real decisionId
      // (actionNumber 5) has no counter match yet in this batch, and
      // nothing else may be substituted for it.
      for (const entry of correlation.values()) {
        expect(entry).not.toBe(moveLog[3]);
      }
      expect(correlation.size).toBe(3);
    });

    it("regression close to the audited Hand 6 symptom: a tile-[1,5] move is never explained by an unrelated tile-[3,5] decision after an earlier multi-draw turn", () => {
      // A longer sequence: opening plays, then a 2-draw turn from the bot
      // (the same collapsing bug applies to botActionCompletion.ts), then
      // several more real decisions -- including a real [3,5] play early
      // and, much later, the real [1,5] play the audit's screenshot showed
      // mislabeled with the [3,5] decision's coaching text.
      const moveLog: MoveEntry[] = [
        makeMoveEntry({ moveNumber: 1, player: 'you', tile: [3, 5] }), // the decision whose text wrongly appeared elsewhere
        makeMoveEntry({ moveNumber: 2, player: 'opponent', action: 'draw', tile: undefined }), // bot's collapsed 2-draw turn
        makeMoveEntry({ moveNumber: 3, player: 'opponent', tile: [5, 6] }),
        makeMoveEntry({ moveNumber: 4, player: 'you', tile: [1, 5] }), // the move the audit found mislabeled
      ];
      const snapshots: ReviewPositionSnapshotV2[] = [
        makeSnapshot(1, 'you', playAction(3, 5)),
        makeSnapshot(2, 'bot', { kind: 'draw' }), // bot draw step 1 of 2 -- correlates to moveNumber 2
        makeSnapshot(3, 'bot', { kind: 'draw' }), // bot draw step 2 of 2 -- drift begins here
        makeSnapshot(4, 'bot', playAction(5, 6)), // the real bot play -- actionNumber now one ahead of moveNumber
        makeSnapshot(5, 'you', playAction(1, 5)), // the real [1,5] play -- actionNumber two ahead
      ];

      const correlation = correlateSnapshotsToMoveLog(snapshots, moveLog);

      // The audited symptom, directly: the [1,5] entry (moveLog[3]) must
      // never be reachable from the [3,5] snapshot's decisionId (the one
      // whose coaching text the audit found wrongly displayed for move 86),
      // nor from any other snapshot that isn't genuinely its own decision.
      expect(correlation.get('pvf-session-1:you:1')).not.toBe(moveLog[3]);
      for (const [, entry] of correlation) {
        expect(entry).not.toBe(moveLog[3]);
      }
      // And the [3,5] entry (moveLog[0]) is reached by exactly its own real
      // decisionId, never by the bot's later, drifted [5,6] play.
      expect(correlation.get('pvf-session-1:you:1')).toEqual(moveLog[0]);
      expect(correlation.get('pvf-session-1:bot:4')).toBeUndefined();
      // The bot's collapsed draw-step-1 is the only other survivor; its own
      // second draw step and its real [5,6] play both land on moveNumbers
      // already claimed by other content and are correctly rejected.
      expect(correlation.size).toBe(2);
    });
  });
});

describe('buildDecisionIdByMoveNumber', () => {
  it('inverts the correlation to moveNumber -> decisionId, for the cheap per-move lookup direction a rendered move actually needs', () => {
    const moveLog: MoveEntry[] = [
      makeMoveEntry({ moveNumber: 1, player: 'you', tile: [3, 4] }),
      makeMoveEntry({ moveNumber: 2, player: 'opponent', tile: [4, 5] }),
    ];
    const snapshots: ReviewPositionSnapshotV2[] = [
      makeSnapshot(1, 'you', playAction(3, 4)),
      makeSnapshot(2, 'bot', playAction(4, 5)),
    ];

    const byMoveNumber = buildDecisionIdByMoveNumber(snapshots, moveLog);

    expect(byMoveNumber.get(1)).toBe('pvf-session-1:you:1');
    expect(byMoveNumber.get(2)).toBe('pvf-session-1:bot:2');
    expect(byMoveNumber.size).toBe(2);
  });

  it('omits a moveNumber with no matching snapshot, same as the underlying correlation', () => {
    const moveLog: MoveEntry[] = [makeMoveEntry({ moveNumber: 1, player: 'you' })];
    const byMoveNumber = buildDecisionIdByMoveNumber([], moveLog);
    expect(byMoveNumber.has(1)).toBe(false);
    expect(byMoveNumber.size).toBe(0);
  });
});

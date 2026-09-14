import { describe, expect, it } from 'vitest';
import { GAME_COMMAND_VERSION, type GameCommand, type GameState } from '@racehorse/game-core';
import {
  REVIEW_POSITION_SNAPSHOT_VERSION,
  createReviewPositionSnapshotV2,
  type ReviewPositionSnapshotV2,
} from '@racehorse/game-core/reviewContracts';
import { REVIEW_FIXTURE_CORPUS } from '../../../../packages/game-core/src/reviewFixtureCorpus.ts';
import { createBotMatch, type BotMatchState, type BotPlayerId } from '../match/runtime/botEngine.ts';
import { toCoreGameState } from '../match/runtime/gameCoreAdapter.ts';
import {
  captureReviewSnapshotAtDecision,
  type CaptureReviewSnapshotIdentifiers,
} from './captureReviewSnapshotAtDecision.ts';

function mapFixtureActorId(id: string): BotPlayerId {
  if (id === 'player' || id === 'you') return 'you';
  if (id === 'opponent' || id === 'bot') return 'bot';
  throw new Error(`Unexpected fixture actor id: ${id}`);
}

function identifiersFromSnapshot(
  snapshot: ReviewPositionSnapshotV2,
): CaptureReviewSnapshotIdentifiers {
  return {
    sessionId: snapshot.identifiers.sessionId,
    gameId: snapshot.identifiers.gameId,
    handId: snapshot.identifiers.handId,
    decisionId: snapshot.identifiers.decisionId,
    mode: snapshot.identifiers.mode,
    gameNumber: snapshot.identifiers.gameNumber,
    actionNumber: snapshot.identifiers.actionNumber,
  };
}

function commandFromSnapshot(snapshot: ReviewPositionSnapshotV2): GameCommand {
  const actorId = mapFixtureActorId(snapshot.identifiers.actorId);
  const base = {
    version: GAME_COMMAND_VERSION,
    commandId: snapshot.identifiers.decisionId,
    sequence: snapshot.identifiers.turnSequence,
    actorId,
  };
  if (snapshot.actualAction.kind === 'play') {
    return {
      ...base,
      kind: 'play',
      tile: snapshot.actualAction.tile,
      position: snapshot.actualAction.position,
    };
  }
  return { ...base, kind: snapshot.actualAction.kind };
}

/** Project fixture authority (`player`/`opponent`) onto PVF `you`/`bot` seats. */
function botMatchFromFixtureAuthority(authority: GameState): BotMatchState {
  const shell = createBotMatch(
    authority.config.winningScore,
    authority.config.tilesPerPlayer as 7 | 14,
  );
  const currentFixtureId = authority.playerIds[authority.currentPlayerIndex];
  return {
    ...shell,
    players: {
      you: {
        hand: authority.players.player.hand.map((tile) => ({ ...tile })),
        score: authority.players.player.score,
      },
      bot: {
        hand: authority.players.opponent.hand.map((tile) => ({ ...tile })),
        score: authority.players.opponent.score,
      },
    },
    board: authority.board
      ? structuredClone(authority.board) as BotMatchState['board']
      : null,
    boneyard: authority.boneyard.map((tile) => ({ ...tile })),
    deadTiles: authority.deadTiles.map((tile) => ({ ...tile })),
    currentPlayer: mapFixtureActorId(currentFixtureId),
    consecutivePasses: authority.consecutivePasses,
    handNumber: authority.handNumber,
    handOpen: authority.handOpen,
    handOver: authority.handOver,
    gameOver: authority.gameOver,
    winnerId: authority.winnerId ? mapFixtureActorId(authority.winnerId) : null,
    turnIndex: authority.sequence,
    winningScore: authority.config.winningScore,
    dealSize: authority.config.tilesPerPlayer as 7 | 14,
    blockedHandRule: authority.config.blockedHandRule,
    endHandBonus: authority.config.endHandBonus,
    scoringMultiple: authority.config.scoringMultiple,
    reviewMissingPipObservations: [],
  };
}

describe('captureReviewSnapshotAtDecision', () => {
  it.each(REVIEW_FIXTURE_CORPUS)(
    '$id ($category): wrapper equals factory(toCoreGameState(preState))',
    (fixture) => {
      const preState = botMatchFromFixtureAuthority(fixture.authorityPreState);
      const command = commandFromSnapshot(fixture.snapshot);
      const identifiers = identifiersFromSnapshot(fixture.snapshot);
      const knownMissingPipEvidence = fixture.snapshot.preAction.knownMissingPipEvidence.map(
        (row) => ({
          ...row,
          opponentId: mapFixtureActorId(row.opponentId),
        }),
      );

      const captured = captureReviewSnapshotAtDecision({
        preState,
        command,
        identifiers,
        knownMissingPipEvidence,
      });

      const direct = createReviewPositionSnapshotV2({
        authorityPreState: toCoreGameState(preState),
        command,
        identifiers,
        knownMissingPipEvidence,
      });

      expect(captured).toEqual(direct);
      expect(captured.snapshotVersion).toBe(REVIEW_POSITION_SNAPSHOT_VERSION);
      const decisionActor = mapFixtureActorId(fixture.snapshot.identifiers.actorId);
      const decisionOpponent: BotPlayerId = decisionActor === 'you' ? 'bot' : 'you';
      expect(captured.preAction.opponentTileCount).toBe(preState.players[decisionOpponent].hand.length);
      expect(captured.preAction.boneyard.physicalCount).toBe(preState.boneyard.length);
      expect(captured.preAction.scores).toEqual({
        actor: preState.players[decisionActor].score,
        opponent: preState.players[decisionOpponent].score,
      });
      expect(captured.actualAction).toEqual(fixture.snapshot.actualAction);
      expect(captured.outcome.immediatePoints).toBe(fixture.snapshot.outcome.immediatePoints);
    },
  );

  it('defaults knownMissingPipEvidence from reviewMissingPipObservations on preState', () => {
    const fixture = REVIEW_FIXTURE_CORPUS.find(
      (row) => row.snapshot.preAction.knownMissingPipEvidence.length > 0,
    );
    expect(fixture).toBeTruthy();
    if (!fixture) return;

    const decisionOpponent: BotPlayerId =
      mapFixtureActorId(fixture.snapshot.identifiers.actorId) === 'you' ? 'bot' : 'you';

    const observations = fixture.snapshot.preAction.knownMissingPipEvidence.map((row) => ({
      actorId: mapFixtureActorId(row.opponentId),
      reason:
        row.reason === 'authority_observation'
          ? ('passed_on_open_end' as const)
          : row.reason,
      observedHandNumber: row.observedHandNumber,
      observedSequence: row.observedSequence,
      openEnds: row.openEnds,
    }));

    const preState = botMatchFromFixtureAuthority(fixture.authorityPreState);
    preState.reviewMissingPipObservations = observations;

    const captured = captureReviewSnapshotAtDecision({
      preState,
      command: commandFromSnapshot(fixture.snapshot),
      identifiers: identifiersFromSnapshot(fixture.snapshot),
    });

    expect(
      captured.preAction.knownMissingPipEvidence.every((row) => row.opponentId === decisionOpponent),
    ).toBe(true);
    expect(captured.preAction.knownMissingPipEvidence.length).toBeGreaterThan(0);
  });
});

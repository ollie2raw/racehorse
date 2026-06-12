import type { GameState } from '../game/types';
import type { Room } from '../rooms';
import type { MatchRow } from './types';

export const QA_FIXTURE_LIVE_QF = 'qa_fixture:live_qf';
export const QA_FIXTURE_NEAR_30_QF = 'qa_fixture:near_30_qf';
export const QA_FIXTURE_OVERLAY_QF_WIN = 'qa_fixture:overlay_qf_win';

const QA_FIXTURE_REASONS = new Set([
  QA_FIXTURE_LIVE_QF,
  QA_FIXTURE_NEAR_30_QF,
  QA_FIXTURE_OVERLAY_QF_WIN,
]);

export function isQaTournamentRoomFixtureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.ENABLE_QA_TOURNAMENT_SEED === '1';
}

export function isQaTournamentRoomFixtureReason(
  statusReason: string | null | undefined,
): statusReason is string {
  return typeof statusReason === 'string' && QA_FIXTURE_REASONS.has(statusReason);
}

function patchScores(
  state: GameState,
  scoresByPlayer: Record<string, number>,
  overrides: Partial<GameState>,
): GameState {
  const players = { ...state.players };
  for (const [playerId, score] of Object.entries(scoresByPlayer)) {
    if (!players[playerId]) continue;
    players[playerId] = { ...players[playerId], score };
  }
  return {
    ...state,
    players,
    handOver: overrides.handOver ?? state.handOver,
    gameOver: overrides.gameOver ?? state.gameOver,
    winnerId: overrides.winnerId !== undefined ? overrides.winnerId : state.winnerId,
    consecutivePasses: 0,
  };
}

/**
 * Applies a deterministic in-memory game snapshot for QA browser harness attach.
 * Only runs when ENABLE_QA_TOURNAMENT_SEED=1 and match.status_reason is a qa_fixture token.
 */
export function applyQaTournamentRoomFixture(input: {
  room: Room;
  match: Pick<MatchRow, 'status_reason'>;
  humanSeatId: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (!isQaTournamentRoomFixtureEnabled(input.env)) return false;
  const reason = input.match.status_reason;
  if (!isQaTournamentRoomFixtureReason(reason)) return false;
  if (!input.room.state) return false;

  const opponentSeatId =
    input.room.players.find((seatId) => seatId !== input.humanSeatId) ?? input.room.players[1];
  if (!opponentSeatId) return false;

  if (reason === QA_FIXTURE_LIVE_QF) {
    input.room.state = patchScores(
      input.room.state,
      { [input.humanSeatId]: 12, [opponentSeatId]: 10 },
      { handOver: false, gameOver: false, winnerId: null },
    );
    return true;
  }

  if (reason === QA_FIXTURE_NEAR_30_QF) {
    input.room.state = patchScores(
      input.room.state,
      { [input.humanSeatId]: 29, [opponentSeatId]: 18 },
      { handOver: false, gameOver: false, winnerId: null },
    );
    return true;
  }

  input.room.state = patchScores(
    input.room.state,
    { [input.humanSeatId]: 30, [opponentSeatId]: 22 },
    { handOver: true, gameOver: true, winnerId: input.humanSeatId },
  );
  return true;
}

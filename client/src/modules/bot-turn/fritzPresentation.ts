/**
 * Fritz cadence theater — presentation phase + score ceremony copy.
 * Shared by Daily Fritz and Play vs Fritz (same bot-turn spine).
 *
 * HUD pill stays calm (thinking / drawing / your move).
 * Score toast owns the ceremony (timed +N; never sticky forever).
 */

export type FritzPresentationPhase =
  | 'idle'
  | 'thinking'
  | 'drawing'
  | 'placing'
  | 'scoring'
  | 'chaining'
  | 'settling';

export type FritzPresentationState = {
  phase: FritzPresentationPhase;
  /** Tiles drawn so far in the current forced-draw sequence. */
  drawCount: number;
  /** Cumulative points scored this Fritz tenure (resets when turn ends). */
  turnScoreTotal: number;
  /** Points from the most recent scoring play in this tenure. */
  lastScorePoints: number;
};

export const IDLE_FRITZ_PRESENTATION: FritzPresentationState = {
  phase: 'idle',
  drawCount: 0,
  turnScoreTotal: 0,
  lastScorePoints: 0,
};

export function buildFritzScoreCeremonyMessage(
  _opponentLabel: string,
  points: number,
  _turnTotal: number,
): string {
  return `+${points}`;
}

export function buildFritzTurnLabel(input: {
  opponentLabel: string;
  botTurn: boolean;
  presentation: FritzPresentationState | null | undefined;
  handOver: boolean;
  gameOver: boolean;
  winnerId?: string | null;
}): string {
  const { opponentLabel, botTurn, presentation, handOver, gameOver, winnerId } = input;

  if (handOver) {
    if (gameOver) {
      return winnerId === 'you'
        ? 'You win the match'
        : `${opponentLabel} wins the match`;
    }
    return '';
  }

  if (!botTurn) return 'Your move';

  // Pill stays calm — only thinking vs drawing. Score ceremony lives on the toast.
  if (presentation?.phase === 'drawing') {
    return `${opponentLabel} is drawing…`;
  }

  return `${opponentLabel} is thinking…`;
}

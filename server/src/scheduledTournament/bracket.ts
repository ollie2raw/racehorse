import type { SeededPlayer } from './types';

/**
 * Standard 8-bracket seed order: pairs the highest seed with the lowest to
 * keep top seeds apart in the early rounds.
 *
 *   QF1: 1 vs 8
 *   QF2: 4 vs 5
 *   QF3: 3 vs 6
 *   QF4: 2 vs 7
 *
 * Winners advance:
 *   SF1: W(QF1) vs W(QF2)
 *   SF2: W(QF3) vs W(QF4)
 *   F:   W(SF1) vs W(SF2)
 *
 * Bye handling: when fewer than 8 players register, the lowest-seeded slots
 * are filled with `null` ("bye"). The bracket pairs a real player against a
 * bye, which the engine auto-advances to the next round.
 */
export const QF_SEED_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 8],
  [4, 5],
  [3, 6],
  [2, 7],
];

export type QfSlot = {
  matchNumber: number;     // 1..4
  player1: SeededPlayer | null;
  player2: SeededPlayer | null;
};

/**
 * Take registered players, sort by rating descending (highest = seed 1),
 * and return the 4 quarterfinal slots.
 *
 * Pure: does not mutate `players`. Stable when ratings are tied (preserves
 * input order, which the caller can pre-sort by registered_at for
 * fairness).
 */
export function seedBracket(players: SeededPlayer[]): QfSlot[] {
  if (players.length < 4) {
    throw new Error('Tournament requires at least 4 registered players');
  }
  if (players.length > 8) {
    throw new Error('Tournament caps at 8 players');
  }

  // Highest rating = seed 1. Stable sort.
  const seeded = [...players]
    .map((p, i) => ({ ...p, _origIdx: i }))
    .sort((a, b) => b.rating - a.rating || a._origIdx - b._origIdx)
    .map(({ _origIdx, ...rest }) => rest);

  // Pad with byes (null) at the bottom seeds.
  const padded: Array<SeededPlayer | null> = [...seeded];
  while (padded.length < 8) padded.push(null);

  return QF_SEED_PAIRS.map(([s1, s2], i) => ({
    matchNumber: i + 1,
    player1: padded[s1 - 1],
    player2: padded[s2 - 1],
  }));
}

/**
 * Given a finished QF match number (1-4), return the SF match number (1-2)
 * the winner advances to and which slot (player1 or player2) they occupy.
 *
 *   QF1 → SF1.player1     QF2 → SF1.player2
 *   QF3 → SF2.player1     QF4 → SF2.player2
 *
 * Given a finished SF match number (1-2), return the Final slot.
 *
 *   SF1 → F1.player1      SF2 → F1.player2
 */
export function advanceSlot(
  round: 1 | 2,
  matchNumber: number,
): { nextRound: 2 | 3; nextMatchNumber: number; slot: 'player1' | 'player2' } {
  if (round === 1) {
    const map: Record<number, { nextMatchNumber: number; slot: 'player1' | 'player2' }> = {
      1: { nextMatchNumber: 1, slot: 'player1' },
      2: { nextMatchNumber: 1, slot: 'player2' },
      3: { nextMatchNumber: 2, slot: 'player1' },
      4: { nextMatchNumber: 2, slot: 'player2' },
    };
    const entry = map[matchNumber];
    if (!entry) throw new Error(`Invalid QF match number: ${matchNumber}`);
    return { nextRound: 2, ...entry };
  }
  // SF → Final
  const map: Record<number, 'player1' | 'player2'> = { 1: 'player1', 2: 'player2' };
  const slot = map[matchNumber];
  if (!slot) throw new Error(`Invalid SF match number: ${matchNumber}`);
  return { nextRound: 3, nextMatchNumber: 1, slot };
}

/** Shown after Classic Daily Fritz losses — routes users to softer practice, not a forced mode switch. */
export const DAILY_FRITZ_CLASSIC_PRACTICE_HINT =
  'Try Standard Fritz in Play vs Fritz for a softer practice matchup.';

export function playerLostDailyFritzGame(playerScore: number, fritzScore: number): boolean {
  return Number(playerScore) < Number(fritzScore);
}

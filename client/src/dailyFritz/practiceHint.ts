/** Shown after Classic Daily Fritz losses — routes users to softer practice, not a forced mode switch. */
export const DAILY_FRITZ_CLASSIC_PRACTICE_HINT =
  'Want a softer matchup? Try Standard in Play vs Fritz.';

export function playerLostDailyFritzGame(playerScore: number, fritzScore: number): boolean {
  return Number(playerScore) < Number(fritzScore);
}

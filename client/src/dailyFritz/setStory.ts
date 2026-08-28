/**
 * Daily Fritz set stories — the one-line description under a racer's name on
 * the leaderboard. Reads the shape of the set (sweep / decider / skunk) rather
 * than restating the score, which is already in the column beside it.
 *
 * Skunk rules: docs/daily-fritz-skunk-source-of-truth.md
 */
import type { DailyFritzLeaderboardRow } from './api';

export type DailyFritzSetStoryTone = 'skunk' | 'skunked' | 'neutral';

export interface DailyFritzSetStory {
  label: string;
  tone: DailyFritzSetStoryTone;
}

type SetStoryInput = Pick<DailyFritzLeaderboardRow, 'won' | 'finalScore' | 'opponentScore' | 'games'>;

function skunkSide(row: SetStoryInput): 'player' | 'fritz' | null {
  const skunkGame = row.games?.find((game) => game.skunk);
  if (!skunkGame) return null;
  return skunkGame.skunkBy ?? (skunkGame.playerWon ? 'player' : 'fritz');
}

export function describeSetStory(row: SetStoryInput): DailyFritzSetStory {
  const skunk = skunkSide(row);
  if (row.won && skunk === 'player') return { label: 'Skunk finish', tone: 'skunk' };
  if (!row.won && skunk === 'fritz') return { label: 'Skunked by Fritz', tone: 'skunked' };

  const games = `${row.finalScore}-${row.opponentScore}`;
  if (row.won) {
    if (games === '2-0') return { label: 'Clean sweep', tone: 'neutral' };
    if (games === '2-1') return { label: 'Won the decider', tone: 'neutral' };
    return { label: 'Took the set', tone: 'neutral' };
  }
  if (games === '0-2') return { label: 'Swept by Fritz', tone: 'neutral' };
  if (games === '1-2') return { label: 'Went the distance', tone: 'neutral' };
  return { label: 'Lost the set', tone: 'neutral' };
}

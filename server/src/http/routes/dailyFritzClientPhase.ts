import type { DailyFritzSetResult } from '../../dailyFritz';

export type DailyFritzClientNextAction =
  | 'play_hand'
  | 'between_games'
  | 'finalize_set'
  | 'view_results'
  | 'locked';

export function resolveDailyFritzClientNextAction(input: {
  attemptStatus: 'started' | 'completed' | 'abandoned' | null;
  setResult: DailyFritzSetResult | null;
  needsCompletion?: boolean;
  currentHandIndex: number;
  hasResumeCheckpoint: boolean;
}): DailyFritzClientNextAction {
  if (input.attemptStatus === 'completed') {
    return 'view_results';
  }
  if (input.attemptStatus === 'abandoned') {
    return 'locked';
  }
  if (input.attemptStatus !== 'started') {
    return 'play_hand';
  }
  if (input.needsCompletion || input.setResult?.setWinner) {
    return 'finalize_set';
  }
  const gamesRecorded = input.setResult?.games.length ?? 0;
  if (gamesRecorded > 0 && input.currentHandIndex === 0) {
    return 'between_games';
  }
  return 'play_hand';
}

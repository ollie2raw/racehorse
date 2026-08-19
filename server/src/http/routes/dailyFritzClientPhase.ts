import type { DailyFritzSetResult } from '../../dailyFritz';

export type DailyFritzClientNextAction =
  | 'start_set'
  | 'resume_hand'
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
  if (input.attemptStatus === 'completed' || input.attemptStatus === 'abandoned') {
    return 'view_results';
  }
  if (input.attemptStatus !== 'started') {
    return 'start_set';
  }
  if (input.needsCompletion || input.setResult?.setWinner) {
    return 'finalize_set';
  }
  const gamesRecorded = input.setResult?.games.length ?? 0;
  if (gamesRecorded > 0 && input.currentHandIndex === 0) {
    return 'between_games';
  }
  if (input.hasResumeCheckpoint || input.currentHandIndex > 0) {
    return 'resume_hand';
  }
  return 'start_set';
}

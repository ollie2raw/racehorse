import type { DailyAttemptState, HomeSourceStatus } from './homeTypes';

export type HomeDailyCardState = 'loading' | 'error' | 'unavailable' | 'incomplete' | 'completed';

export type HomeDailyResultKind = 'fritz' | 'puzzle';

export type HomeDailyResultCopy = {
  badge: 'Finished' | 'Solved';
  outcome: 'Win' | 'Loss' | null;
};

export function getHomeDailyResultCopy(
  kind: HomeDailyResultKind,
  outcome: 'win' | 'loss' | null = null,
): HomeDailyResultCopy {
  return {
    badge: kind === 'fritz' ? 'Finished' : 'Solved',
    outcome: kind === 'fritz' && outcome ? outcome === 'win' ? 'Win' : 'Loss' : null,
  };
}

export function getHomeDailyCardState(
  status: HomeSourceStatus,
  attemptState: DailyAttemptState | null,
): HomeDailyCardState {
  if (status === 'loading') return 'loading';
  if (status === 'error') return 'error';
  if (status === 'unavailable') return 'unavailable';
  return attemptState === 'completed' ? 'completed' : 'incomplete';
}

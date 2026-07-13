import { describe, expect, it } from 'vitest';
import { getHomeDailyCardState, getHomeDailyResultCopy } from './homeDailyCardPresentation';

describe('getHomeDailyCardState', () => {
  it.each([
    ['authenticated incomplete Daily Fritz', 'ready', 'started', 'incomplete'],
    ['authenticated completed Daily Fritz', 'ready', 'completed', 'completed'],
    ['guest unavailable Daily Fritz', 'unavailable', 'unstarted', 'unavailable'],
    ['loading Daily Puzzle', 'loading', 'unstarted', 'loading'],
    ['failed Daily Puzzle', 'error', 'completed', 'error'],
    ['ready unknown Daily Puzzle', 'ready', 'unknown', 'incomplete'],
  ] as const)('%s', (_name, status, attemptState, expected) => {
    expect(getHomeDailyCardState(status, attemptState)).toBe(expected);
  });

  it('does not treat missing optional result data as a different completed state', () => {
    expect(getHomeDailyCardState('ready', 'completed')).toBe('completed');
    expect(getHomeDailyCardState('ready', null)).toBe('incomplete');
  });

  it('uses one completion label and one Fritz outcome label', () => {
    expect(getHomeDailyResultCopy('fritz', 'loss')).toEqual({ badge: 'Finished', outcome: 'Loss' });
    expect(getHomeDailyResultCopy('fritz', null)).toEqual({ badge: 'Finished', outcome: null });
    expect(getHomeDailyResultCopy('puzzle')).toEqual({ badge: 'Solved', outcome: null });
  });
});

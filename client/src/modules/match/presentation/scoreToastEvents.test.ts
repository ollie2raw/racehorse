// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  clearScoreToastEvent,
  hideScoreToastEvent,
  resolveCommittedScoreEvent,
} from './scoreToastEvents.ts';

describe('resolveCommittedScoreEvent', () => {
  it('emits the committed player score delta', () => {
    expect(resolveCommittedScoreEvent(
      { you: 10, bot: 5 },
      { you: 15, bot: 5 },
    )).toEqual({ player: 'you', points: 5 });
  });

  it('emits the committed Fritz score delta', () => {
    expect(resolveCommittedScoreEvent(
      { you: 10, bot: 5 },
      { you: 10, bot: 15 },
    )).toEqual({ player: 'bot', points: 10 });
  });

  it('does not misread hydration, resets, or unchanged scores as a play', () => {
    expect(resolveCommittedScoreEvent(
      { you: 0, bot: 0 },
      { you: 10, bot: 10 },
    )).toBeNull();
    expect(resolveCommittedScoreEvent(
      { you: 55, bot: 45 },
      { you: 0, bot: 0 },
    )).toBeNull();
    expect(resolveCommittedScoreEvent(
      { you: 10, bot: 5 },
      { you: 10, bot: 5 },
    )).toBeNull();
  });

  it('suppresses hand-end award points when no played tile scored', () => {
    expect(resolveCommittedScoreEvent(
      { you: 25, bot: 20 },
      { you: 35, bot: 20 },
      { handOver: true, playedTilePoints: 0 },
    )).toBeNull();
  });

  it('announces only tile points when a scoring play also ends the hand', () => {
    expect(resolveCommittedScoreEvent(
      { you: 25, bot: 20 },
      { you: 45, bot: 20 },
      { handOver: true, playedTilePoints: 5 },
    )).toEqual({ player: 'you', points: 5 });
  });
});

describe('score toast timer ownership', () => {
  const newerToast = { eventId: 2, visible: true, message: '+10' };

  it('does not let an older hide timer dismiss a newer score', () => {
    expect(hideScoreToastEvent(newerToast, 1)).toBe(newerToast);
  });

  it('does not let an older clear timer remove a newer score', () => {
    expect(clearScoreToastEvent(newerToast, 1)).toBe(newerToast);
  });

  it('hides and clears only the timer owner', () => {
    expect(hideScoreToastEvent(newerToast, 2)).toEqual({
      ...newerToast,
      visible: false,
    });
    expect(clearScoreToastEvent(newerToast, 2)).toBeNull();
  });
});

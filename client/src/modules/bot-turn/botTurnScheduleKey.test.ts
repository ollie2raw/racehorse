// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildBotTurnScheduleKey } from './useBotTurnEffect.ts';
import { shouldScheduleBotTurn, shouldContinueBotTurnAtTimer } from './botTurnGuards.ts';
import { createBotMatch } from '../match/runtime/botEngine.ts';

describe('buildBotTurnScheduleKey', () => {
  it('ignores hand, boneyard, and board length churn during the same tenure', () => {
    const base = {
      currentPlayer: 'bot',
      handNumber: 1,
      handOver: false,
      gameOver: false,
      retryNonce: 0,
    };
    const before = buildBotTurnScheduleKey(base);
    // Presentation / apply churn must not remount the active tenure.
    expect(buildBotTurnScheduleKey(base)).toBe(before);
    expect(before).toBe('bot:1:false:false:0');
  });

  it('changes when currentPlayer hands off', () => {
    expect(buildBotTurnScheduleKey({
      currentPlayer: 'bot',
      handNumber: 1,
      handOver: false,
      gameOver: false,
      retryNonce: 0,
    })).not.toBe(buildBotTurnScheduleKey({
      currentPlayer: 'you',
      handNumber: 1,
      handOver: false,
      gameOver: false,
      retryNonce: 0,
    }));
  });

  it('changes when handNumber advances (new hand / game progression)', () => {
    expect(buildBotTurnScheduleKey({
      currentPlayer: 'bot',
      handNumber: 1,
      handOver: false,
      gameOver: false,
      retryNonce: 0,
    })).not.toBe(buildBotTurnScheduleKey({
      currentPlayer: 'bot',
      handNumber: 2,
      handOver: false,
      gameOver: false,
      retryNonce: 0,
    }));
  });

  it('changes when retryNonce bumps (intentional reschedule)', () => {
    expect(buildBotTurnScheduleKey({
      currentPlayer: 'bot',
      handNumber: 1,
      handOver: false,
      gameOver: false,
      retryNonce: 0,
    })).not.toBe(buildBotTurnScheduleKey({
      currentPlayer: 'bot',
      handNumber: 1,
      handOver: false,
      gameOver: false,
      retryNonce: 1,
    }));
  });

  it('changes when handOver or gameOver flips', () => {
    const active = buildBotTurnScheduleKey({
      currentPlayer: 'bot',
      handNumber: 1,
      handOver: false,
      gameOver: false,
      retryNonce: 0,
    });
    expect(buildBotTurnScheduleKey({
      currentPlayer: 'bot',
      handNumber: 1,
      handOver: true,
      gameOver: false,
      retryNonce: 0,
    })).not.toBe(active);
    expect(buildBotTurnScheduleKey({
      currentPlayer: 'bot',
      handNumber: 1,
      handOver: false,
      gameOver: true,
      retryNonce: 0,
    })).not.toBe(active);
  });
});

describe('bot tenure scheduling vs terminal state', () => {
  it('does not schedule an additional bot action after handOver', () => {
    const match = createBotMatch(60, 7);
    match.currentPlayer = 'bot';
    match.handOver = true;
    expect(shouldScheduleBotTurn({
      match,
      drawSequenceActive: false,
      botTurnInFlight: false,
      preGameDrawActive: false,
      isDailyFritzMode: true,
      dailyFritzSetResult: null,
      isGuidedTranscriptMode: false,
      isGuidedV2Mode: false,
      isGuidedV2OffLine: false,
    })).toBe(false);
  });

  it('does not continue the bot chain after handOver', () => {
    const match = createBotMatch(60, 7);
    match.currentPlayer = 'bot';
    match.handOver = true;
    expect(shouldContinueBotTurnAtTimer({
      match,
      isDailyFritzMode: true,
      dailyFritzSetResult: null,
    })).toBe(false);
  });

  it('schedules a genuine new bot tenure when it is Fritz to move', () => {
    const match = createBotMatch(60, 7);
    match.currentPlayer = 'bot';
    match.handOver = false;
    match.gameOver = false;
    expect(shouldScheduleBotTurn({
      match,
      drawSequenceActive: false,
      botTurnInFlight: false,
      preGameDrawActive: false,
      isDailyFritzMode: true,
      dailyFritzSetResult: null,
      isGuidedTranscriptMode: false,
      isGuidedV2Mode: false,
      isGuidedV2OffLine: false,
    })).toBe(true);
  });
});

describe('Strict Mode schedule-key stability', () => {
  it('double invoke with the same tenure key does not invent a second identity', () => {
    const keyA = buildBotTurnScheduleKey({
      currentPlayer: 'bot',
      handNumber: 1,
      handOver: false,
      gameOver: false,
      retryNonce: 0,
    });
    const keyB = buildBotTurnScheduleKey({
      currentPlayer: 'bot',
      handNumber: 1,
      handOver: false,
      gameOver: false,
      retryNonce: 0,
    });
    // React Strict Mode remounts the effect with the same key; identity must match
    // so the second mount replaces the cancelled first run instead of dual tenures.
    expect(keyA).toBe(keyB);
  });
});

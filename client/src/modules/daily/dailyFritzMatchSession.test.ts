import { describe, expect, it } from 'vitest';
import { createBotMatch, startNextFixedBotHand, type BotMatchState } from '../match/runtime/botEngine.ts';
import {
  dailyFritzSessionReducer,
  isCoherentDailyFritzSession,
  type DailyFritzAuthorityCursor,
  type DailyFritzMatchSession,
} from './dailyFritzMatchSession.ts';

function coherentSession(handIndex: number, handNumber = handIndex + 1): DailyFritzMatchSession {
  const match = createBotMatch(60, 7);
  match.handNumber = handNumber;
  return {
    cursor: { gameNumber: 1, handIndex, revision: handIndex + 4 },
    match,
  };
}

function terminalHand(session: DailyFritzMatchSession): BotMatchState {
  return {
    ...session.match,
    handOver: true,
    gameOver: false,
    players: {
      you: { ...session.match.players.you, score: 15 },
      bot: { ...session.match.players.bot, score: 10 },
    },
  };
}

describe('dailyFritzSessionReducer', () => {
  it('preserves coherence through engine updates on an active hand', () => {
    let session = coherentSession(0);
    const played = {
      ...session.match,
      currentPlayer: 'bot' as const,
    };
    session = dailyFritzSessionReducer(session, { type: 'APPLY_ENGINE_RESULT', match: played });
    expect(isCoherentDailyFritzSession(session)).toBe(true);
    expect(session.match.currentPlayer).toBe('bot');
    expect(session.cursor).toEqual(coherentSession(0).cursor);
  });

  it('APPLY_NEXT_HAND atomically advances cursor and match together', () => {
    const session = coherentSession(1, 2);
    const terminal = terminalHand(session);
    const nextCursor: DailyFritzAuthorityCursor = { gameNumber: 1, handIndex: 2, revision: 9 };
    const nextMatch = startNextFixedBotHand(terminal, {
      player_tiles: [{ low: 1, high: 2 }],
      fritz_tiles: [{ low: 3, high: 4 }],
      boneyard: [],
      locked: [],
    });
    nextMatch.handNumber = 3;

    const next = dailyFritzSessionReducer(session, {
      type: 'APPLY_NEXT_HAND',
      cursor: nextCursor,
      match: nextMatch,
    });

    expect(next.cursor).toEqual(nextCursor);
    expect(next.match.handNumber).toBe(3);
    expect(isCoherentDailyFritzSession(next)).toBe(true);
  });

  it('rejects APPLY_NEXT_HAND that would produce an incoherent session', () => {
    const session = coherentSession(1, 2);
    const terminal = terminalHand(session);
    const tornCursor: DailyFritzAuthorityCursor = { gameNumber: 1, handIndex: 2, revision: 9 };
    const staleMatch = { ...terminal, handNumber: 2 };

    expect(() => dailyFritzSessionReducer(session, {
      type: 'APPLY_NEXT_HAND',
      cursor: tornCursor,
      match: staleMatch,
    })).toThrow(/incoherent session/i);
  });

  it('never produces incoherent state via APPLY_NEXT_HAND after a terminal hand', () => {
    let session = coherentSession(0, 1);
    session = dailyFritzSessionReducer(session, {
      type: 'APPLY_ENGINE_RESULT',
      match: terminalHand(session),
    });
    expect(isCoherentDailyFritzSession(session)).toBe(true);

    const nextMatch = startNextFixedBotHand(session.match, {
      player_tiles: [{ low: 0, high: 1 }],
      fritz_tiles: [{ low: 2, high: 3 }],
      boneyard: [{ low: 4, high: 5 }],
      locked: [],
    });
    nextMatch.handNumber = 2;

    session = dailyFritzSessionReducer(session, {
      type: 'APPLY_NEXT_HAND',
      cursor: { gameNumber: 1, handIndex: 1, revision: 5 },
      match: nextMatch,
    });

    expect(isCoherentDailyFritzSession(session)).toBe(true);
    expect(session.cursor.handIndex).toBe(1);
    expect(session.match.handNumber).toBe(2);
  });

  it('does not advance cursor on APPLY_END_OF_RUN', () => {
    const session = coherentSession(2, 3);
    const terminal = {
      ...terminalHand(session),
      gameOver: true,
      winnerId: 'you' as const,
    };
    const next = dailyFritzSessionReducer(session, { type: 'APPLY_END_OF_RUN', match: terminal });
    expect(next.cursor).toEqual(session.cursor);
    expect(next.match.gameOver).toBe(true);
    expect(isCoherentDailyFritzSession(next)).toBe(true);
  });

  it('never persists a new authority cursor with the previous hand match (reducer port)', () => {
    const handOne = coherentSession(0, 1);
    const handTwoMatch = { ...handOne.match, handNumber: 2 };
    const tornCursor: DailyFritzAuthorityCursor = { gameNumber: 1, handIndex: 1, revision: 5 };

    expect(() => dailyFritzSessionReducer(handOne, {
      type: 'APPLY_NEXT_HAND',
      cursor: tornCursor,
      match: handOne.match,
    })).toThrow(/incoherent session/i);

    const handTwo = dailyFritzSessionReducer(handOne, {
      type: 'APPLY_NEXT_HAND',
      cursor: tornCursor,
      match: handTwoMatch,
    });
    expect(isCoherentDailyFritzSession(handTwo)).toBe(true);
    expect(handTwo.cursor.handIndex).toBe(1);
    expect(handTwo.match.handNumber).toBe(2);
  });
});

// @vitest-environment jsdom
/**
 * The Guided Match entry and restore logic in lessonV2.ts (code-health audit: no direct tests). A guided lesson is a recorded
 * match replayed through the bot screen; the screen restores the position before any event (to start a hand, jump to a hand
 * boundary, or resume), and resolveGuidedMatchStart decides whether the lesson can start at all. These use a small two-hand
 * fixture built from real engine snapshots and boards serialised the way the app serialises them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardState } from '../types';
import { serializeGhostBoardState } from '../ghost/logic';
import { createBotMatch } from '../modules/match/runtime/botEngine';
import type { LessonV2, LessonV2Event, LessonV2HandStart } from './lessonV2';

const loader = vi.hoisted(() => ({
  playback: null as unknown,
  throws: false,
  issues: [] as string[],
}));
vi.mock('./guidedMatch/guidedMatchLessonLoader', () => ({
  getPublicGuidedMatchPlaybackLesson: () => {
    if (loader.throws) throw new Error('The bundled guided match lesson is unavailable.');
    return loader.playback;
  },
  getPublicGuidedMatchLessonSanityIssues: () => loader.issues,
}));

const {
  canStartGuidedV2Lesson,
  firstEventIndexForHand,
  initGuidedV2Playback,
  nextPlayerEvent,
  restoreGuidedV2HandStart,
  restoreHandStart,
  restoreMatchStateBeforeEvent,
  resolveGuidedMatchStart,
  validateGuidedV2LessonPlayback,
} = await import('./lessonV2');

afterEach(() => {
  loader.playback = null;
  loader.throws = false;
  loader.issues = [];
});

const board = (low: number, high: number): BoardState => ({
  mainLine: [{ tile: { low, high }, orientation: 'horizontal-normal' }],
  leftEnd: low,
  rightEnd: high,
  leftEndIsDouble: low === high,
  rightEndIsDouble: low === high,
  hubDoubles: [],
});

function event(index: number, hand: number, actor: 'player' | 'fritz', over: Partial<LessonV2Event> = {}): LessonV2Event {
  return {
    eventIndex: index,
    handNumber: hand,
    actor,
    action: 'play',
    tile: '3|4',
    position: 'left',
    boardAfter: serializeGhostBoardState(board(3, 4)),
    playerHandAfter: ['1|2', '5|6'],
    fritzHandAfter: ['0|0', '2|2', '6|6'],
    boneyardCountAfter: 7,
    pointsScored: 0,
    playerScoreAfter: 10 + index,
    fritzScoreAfter: 5 + index,
    turnContinues: false,
    handOver: false,
    gameOver: false,
    coachingText: actor === 'player' ? `Tip ${index}` : '',
    ...over,
  };
}

const handStart = (hand: number, firstEventIndex: number): LessonV2HandStart => ({
  handNumber: hand,
  matchStateJson: JSON.stringify({ ...createBotMatch(60, 7), handNumber: hand }),
  firstEventIndex,
});

/** Hand 1: events 0 (you), 1 (Fritz), 2 (you). Hand 2: events 3 (you), 4 (Fritz). */
function lesson(over: Partial<LessonV2> = {}): LessonV2 {
  return {
    version: 2,
    lessonId: 'lesson-1',
    gameId: 'game-1',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    handStarts: [handStart(1, 0), handStart(2, 3)],
    events: [
      event(0, 1, 'player'),
      event(1, 1, 'fritz'),
      event(2, 1, 'player', { handOver: true }),
      event(3, 2, 'player', { playerScoreAfter: 40, fritzScoreAfter: 20 }),
      event(4, 2, 'fritz', { playerScoreAfter: 40, fritzScoreAfter: 20 }),
    ],
    ...over,
  };
}

describe('finding positions in a lesson', () => {
  it('finds the first event of a hand, or -1 when the hand is not in the lesson', () => {
    const starts = lesson().handStarts;
    expect(firstEventIndexForHand(starts, 1)).toBe(0);
    expect(firstEventIndexForHand(starts, 2)).toBe(3);
    expect(firstEventIndexForHand(starts, 9)).toBe(-1);
  });

  it('finds the next move the player has to make, skipping Fritz', () => {
    const { events } = lesson();
    expect(nextPlayerEvent(events, 0)?.eventIndex).toBe(0);
    expect(nextPlayerEvent(events, 1)?.eventIndex).toBe(2);
    expect(nextPlayerEvent(events, 4)).toBeNull();
    expect(nextPlayerEvent(events, 99)).toBeNull();
  });
});

describe('restoring a hand start', () => {
  it('restores the saved snapshot, and returns null for a corrupt one instead of throwing', () => {
    expect(restoreHandStart(handStart(2, 3))?.handNumber).toBe(2);
    expect(restoreHandStart({ handNumber: 2, matchStateJson: '{not json', firstEventIndex: 3 })).toBeNull();
  });

  it('restores a hand from its snapshot, with the index of its first event', () => {
    const restored = restoreGuidedV2HandStart(lesson(), 2);
    expect(restored.firstEventIndex).toBe(3);
    expect(restored.state?.handNumber).toBe(2);
  });

  it('falls back to the first event of that hand when there is no snapshot for it', () => {
    const restored = restoreGuidedV2HandStart(lesson({ handStarts: [handStart(1, 0)] }), 2);
    expect(restored.firstEventIndex).toBe(3);
    expect(restored.state).not.toBeNull();
    expect(restored.state?.handNumber).toBe(2);
  });
});

describe('restoreMatchStateBeforeEvent', () => {
  it('before the very first event is the start of that hand', () => {
    const state = restoreMatchStateBeforeEvent(lesson(), 0);
    expect(state?.handNumber).toBe(1);
  });

  it('mid-hand is rebuilt from the PREVIOUS event: its board, both hands and both scores, with the right player to move', () => {
    const l = lesson();
    const state = restoreMatchStateBeforeEvent(l, 2); // before your second move, after Fritz's reply
    expect(state?.handNumber).toBe(1);
    expect(state?.board?.mainLine).toHaveLength(1);
    expect(state?.board?.leftEnd).toBe(3);
    expect(state?.players.you.hand.map((t) => `${t.low}|${t.high}`)).toEqual(['1|2', '5|6']);
    expect(state?.players.bot.hand).toHaveLength(3);
    expect(state?.players.you.score).toBe(l.events[1]!.playerScoreAfter);
    expect(state?.players.bot.score).toBe(l.events[1]!.fritzScoreAfter);
    expect(state?.currentPlayer).toBe('you');
    expect(state?.boneyard).toHaveLength(7);
    expect(state?.handOver).toBe(false);
    expect(state?.gameOver).toBe(false);
    expect(state?.handOpen).toBe(true);
  });

  it("before Fritz's move it is Fritz's turn", () => {
    expect(restoreMatchStateBeforeEvent(lesson(), 1)?.currentPlayer).toBe('bot');
  });

  it("the first event of a LATER hand starts from that hand's own snapshot, not the previous hand's last position", () => {
    const state = restoreMatchStateBeforeEvent(lesson(), 3);
    expect(state?.handNumber).toBe(2);
    expect(state?.board).toBeNull();
    expect(state?.handOver).toBe(false);
  });

  it('an index past the end falls back to a hand start instead of crashing', () => {
    expect(() => restoreMatchStateBeforeEvent(lesson(), 99)).not.toThrow();
    expect(restoreMatchStateBeforeEvent(lesson(), 99)?.handNumber).toBe(1);
  });

  it('a negative index is the start of the first hand', () => {
    expect(restoreMatchStateBeforeEvent(lesson(), -3)?.handNumber).toBe(1);
  });
});

describe('initGuidedV2Playback', () => {
  it('opens a hand at its first event with the position before it', () => {
    const playback = initGuidedV2Playback(lesson(), 2);
    expect(playback.firstEventIndex).toBe(3);
    expect(playback.state?.handNumber).toBe(2);
  });

  it('defaults to the first hand', () => {
    const playback = initGuidedV2Playback(lesson());
    expect(playback.firstEventIndex).toBe(0);
    expect(playback.state?.handNumber).toBe(1);
  });
});

describe('can this lesson start, and is it playable', () => {
  it('a lesson with moves can start; nothing can not', () => {
    expect(canStartGuidedV2Lesson(lesson())).toBe(true);
    expect(canStartGuidedV2Lesson(null)).toBe(false);
    expect(canStartGuidedV2Lesson(lesson({ events: [], handStarts: [] }))).toBe(false);
  });

  it('explains why a missing or empty lesson is not playable, and passes a good one', () => {
    expect(validateGuidedV2LessonPlayback(null)).toMatch(/no guided lesson/i);
    expect(validateGuidedV2LessonPlayback(lesson({ events: [], handStarts: [] }))).toMatch(/no recorded moves/i);
    expect(validateGuidedV2LessonPlayback(lesson())).toBeNull();
  });
});

describe('resolveGuidedMatchStart', () => {
  it('starts the v2 route when the bundled lesson loads and is playable', () => {
    loader.playback = lesson();
    expect(resolveGuidedMatchStart()).toEqual({ route: 'v2', error: null });
  });

  it('when the lesson cannot be loaded at all, says so (that message wins over the sanity-check list)', () => {
    loader.throws = true;
    loader.issues = ['the bundled lesson could not be loaded'];
    const start = resolveGuidedMatchStart();
    expect(start.route).toBeNull();
    expect(start.error).toBe('No guided lesson is loaded.');
  });

  // CURRENT BEHAVIOUR, recorded rather than endorsed: the sanity checks (expected event count, coaching count, hand count) are
  // advisory. A lesson that is playable starts even when they report problems; they only show up in the dev console.
  it('starts a playable lesson even when its sanity checks report problems', () => {
    loader.playback = lesson();
    loader.issues = ['events.length expected 232, received 5'];
    expect(resolveGuidedMatchStart()).toEqual({ route: 'v2', error: null });
  });

  it('says it is unavailable when there is no lesson and no particular reason', () => {
    loader.throws = true;
    const start = resolveGuidedMatchStart();
    expect(start.route).toBeNull();
    expect(start.error).toBeTruthy();
  });

  it('refuses a lesson that has moves but cannot be restored', () => {
    loader.playback = lesson({ handStarts: [{ handNumber: 1, matchStateJson: '{broken', firstEventIndex: 0 }], events: [] });
    const start = resolveGuidedMatchStart();
    expect(start.route).toBeNull();
    expect(start.error).toBeTruthy();
  });
});

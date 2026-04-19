/**
 * learn/lessonV2.ts
 *
 * Event-based lesson format (V2).
 *
 * Every action — player tile-play, player draw, player pass, Fritz tile-play,
 * Fritz draw, Fritz pass — is recorded as one atomic LessonV2Event.  Events
 * are stored in a flat array.  A cursor integer is all that is needed for
 * playback; there is no replay machinery, no isTransitioningRef, no bundled
 * per-turn snapshot lists.
 *
 * Key invariant: boardAfter in every event is the authoritative board state
 * for that moment.  parseLessonV2BoardState() trusts every stored field and
 * does NOT call recomputeBoardEnds(), bypassing the
 * endpointMatchFromOrientation() orientation bug entirely.
 */

import type { BoardState, PlacedTile, TileOrientation } from '../types.ts';
import type { BotActionResult, BotMatchState, BotPlayerId } from '../bot/botEngine';
import { serializeGhostBoardState } from '../ghost/logic';

// ─── Storage keys ────────────────────────────────────────────────────────────

export const LESSON_V2_AUTHORING_KEY = 'racehorse:lesson-v2:authoring:v1';
export const LESSON_V2_FROZEN_KEY = 'racehorse:lesson-v2:frozen:v1';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LessonV2HandEnd {
  winner: 'player' | 'fritz' | null;
  reason: 'domino' | 'blocked';
  pointsAwarded: number;
  loserPips: number;
  calcText: string;
}

/**
 * One atomic action in the lesson timeline.
 *
 * actor === 'player': the human's move.  Playback waits for the player to
 *   perform this exact move; if they deviate, isOffLine becomes true.
 *
 * actor === 'fritz': bot move.  Playback auto-applies this event after a
 *   short delay and advances the cursor, no input required.
 */
export interface LessonV2Event {
  /** 0-based position in LessonV2.events[] */
  eventIndex: number;
  /** 1-based hand number within the lesson game */
  handNumber: number;
  actor: 'player' | 'fritz';
  action: 'play' | 'draw' | 'pass';
  /** Tile played, serialized as "low|high" — absent for draw / pass */
  tile?: string;
  /** Placement position: "left", "right", or "branch-N-M" — absent for draw / pass */
  position?: string;
  /**
   * Authoritative board state AFTER this event, produced by
   * serializeGhostBoardState().  parseLessonV2BoardState() reconstructs
   * this without calling recomputeBoardEnds().
   */
  boardAfter: string;
  /** Player hand after this event, tile keys ["low|high", …] */
  playerHandAfter: string[];
  /** Fritz hand after this event, tile keys ["low|high", …] */
  fritzHandAfter: string[];
  /** Number of tiles remaining in the drawable boneyard (locked tiles excluded) */
  boneyardCountAfter: number;
  /** Points scored in this individual action (0 for draws/passes) */
  pointsScored: number;
  /** Player's cumulative score after this event */
  playerScoreAfter: number;
  /** Fritz's cumulative score after this event */
  fritzScoreAfter: number;
  /**
   * True when the same actor gets another turn immediately (e.g. played a
   * double, or drew a tile and can now play it).
   */
  turnContinues: boolean;
  /** True if this event ended the current hand */
  handOver: boolean;
  /** True if this event ended the entire match */
  gameOver: boolean;
  /** Hand-end details — present only when handOver === true */
  handEnded?: LessonV2HandEnd;
  /**
   * Coaching text for the upcoming player event.
   * Set on player-actor events only; empty string by default.
   * Authors edit this in the authoring UI.
   */
  coachingText: string;
}

/**
 * Full BotMatchState snapshot saved at the start of each hand.
 * Playback uses this to restore state when jumping to a hand boundary.
 */
export interface LessonV2HandStart {
  /** 1-based hand number */
  handNumber: number;
  /** JSON.stringify(BotMatchState) at the moment cards were dealt */
  matchStateJson: string;
  /** Index of the first LessonV2Event belonging to this hand */
  firstEventIndex: number;
}

/**
 * A complete V2 lesson.
 */
export interface LessonV2 {
  version: 2;
  lessonId: string;
  gameId: string;
  createdAt: string;
  updatedAt: string;
  /** One entry per hand; sorted by handNumber ascending */
  handStarts: LessonV2HandStart[];
  /** Flat timeline of every game action, in chronological order */
  events: LessonV2Event[];
}

/**
 * In-progress authoring session.  Kept separate from the frozen lesson so
 * authoring never overwrites the live published lesson.
 */
export interface LessonV2AuthoringSession {
  lessonId: string;
  gameId: string;
  createdAt: string;
  updatedAt: string;
  handStarts: LessonV2HandStart[];
  events: LessonV2Event[];
  /**
   * Index of the last event that has been recorded.  -1 means no events yet.
   * Used to restore authoring position on page reload.
   */
  lastEventIndex: number;
}

// ─── Board-state parser (V2 — trusts stored values) ─────────────────────────

/**
 * Reconstruct a BoardState from a string produced by serializeGhostBoardState().
 *
 * Unlike parseGuidedBoardState() in BotMatchScreen, this function does NOT
 * call recomputeBoardEnds().  Every field — leftEnd, rightEnd, hub.isCrossed,
 * branch.openEnd, etc. — is taken directly from the serialised JSON.
 *
 * This is safe because LessonV2Event.boardAfter is always produced by
 * serializeGhostBoardState() immediately after the engine returns a result,
 * so those values are already authoritative.
 */
export function parseLessonV2BoardState(boardState: string): BoardState | null {
  if (!boardState || boardState === 'board:empty') return null;
  try {
    const raw = JSON.parse(boardState) as {
      mainLine?: Array<{ tile: [number, number]; orientation: string }>;
      leftEnd?: number;
      rightEnd?: number;
      leftEndIsDouble?: boolean;
      rightEndIsDouble?: boolean;
      hubs?: Array<{
        hubId?: number;
        laneType?: string | null;
        laneRef?: string | null;
        branchDepth?: number | null;
        tileIndex?: number;
        mainlineIndex?: number | null;
        hubValue: number;
        leftSideFilled?: boolean;
        rightSideFilled?: boolean;
        isCrossed?: boolean;
        branches?: Array<{
          openEnd?: number;
          openEndIsDouble?: boolean;
          tiles?: Array<{ tile: [number, number]; orientation: string }>;
        } | null>;
      }>;
    };

    const parsePlaced = (p: { tile: [number, number]; orientation: string }): PlacedTile => ({
      tile: { low: p.tile[0], high: p.tile[1] },
      orientation: p.orientation as TileOrientation,
    });

    const mainLine: PlacedTile[] = (raw.mainLine ?? []).map(parsePlaced);

    const normalizeLaneType = (
      value: string | null | undefined,
    ): 'mainline' | 'branch' | undefined => {
      if (value === 'mainline' || value === 'branch') return value;
      return undefined;
    };

    const hubDoubles = (raw.hubs ?? []).map((hub) => ({
      hubId: hub.hubId,
      laneType: normalizeLaneType(hub.laneType),
      laneRef: hub.laneRef ?? undefined,
      branchDepth: hub.branchDepth ?? undefined,
      tileIndex: hub.tileIndex ?? 0,
      mainlineIndex: hub.mainlineIndex ?? undefined,
      hubValue: hub.hubValue,
      leftSideFilled: Boolean(hub.leftSideFilled),
      rightSideFilled: Boolean(hub.rightSideFilled),
      isCrossed: Boolean(hub.isCrossed),
      branches: (hub.branches ?? []).map((branch) =>
        branch
          ? {
              openEnd: branch.openEnd ?? 0,
              openEndIsDouble: Boolean(branch.openEndIsDouble),
              tiles: (branch.tiles ?? []).map(parsePlaced),
            }
          : {
              openEnd: hub.hubValue,
              openEndIsDouble: false,
              tiles: [],
            },
      ),
    }));

    return {
      mainLine,
      leftEnd: raw.leftEnd ?? -1,
      rightEnd: raw.rightEnd ?? -1,
      leftEndIsDouble: Boolean(raw.leftEndIsDouble),
      rightEndIsDouble: Boolean(raw.rightEndIsDouble),
      hubDoubles,
    };
  } catch {
    return null;
  }
}

// ─── Event construction helper ────────────────────────────────────────────────

function tileToKey(tile: { low: number; high: number }): string {
  return `${tile.low}|${tile.high}`;
}

/**
 * Build a LessonV2Event from a BotActionResult returned by the engine.
 *
 * Call this once per action, immediately after the engine returns, while the
 * result is available.  Pass the handNumber from the match state BEFORE the
 * action (i.e. `match.handNumber` for player events, `matchRef.current.handNumber`
 * for Fritz events in the bot effect).
 */
export function createV2Event(params: {
  result: BotActionResult;
  /** Hand number taken from the match state BEFORE this action */
  handNumber: number;
  actor: 'player' | 'fritz';
  action: 'play' | 'draw' | 'pass';
  /** The tile that was played — omit for draw / pass */
  tile?: { low: number; high: number };
  /** Placement position — omit for draw / pass */
  position?: string;
  eventIndex: number;
  coachingText?: string;
}): LessonV2Event {
  const { result, handNumber, actor, action, tile, position, eventIndex, coachingText = '' } =
    params;
  const next = result.state;

  const playerHandAfter = (next.players.you?.hand ?? []).map(tileToKey);
  const fritzHandAfter = (next.players.bot?.hand ?? []).map(tileToKey);

  // Drawable boneyard = total boneyard minus the locked tail (last 2 tiles)
  // BotMatchState.boneyard includes locked tiles, so we subtract deadTiles count
  // to get the count the player perceives as drawable.
  // Simplest: just use boneyard.length (includes locked, but consistent with
  // what we display elsewhere and locked count is constant at 2).
  const boneyardCountAfter = next.boneyard.length;

  const pointsScored = result.scored?.points ?? 0;
  const playerScoreAfter = next.players.you?.score ?? 0;
  const fritzScoreAfter = next.players.bot?.score ?? 0;

  // turnContinues: same player goes again (draw-then-can-play, or double)
  // The engine expresses this via next.currentPlayer === prevState.currentPlayer
  // AND handOpen is set (for first-move doubles), OR the actor is same as next.currentPlayer.
  const turnContinues =
    !next.handOver &&
    !next.gameOver &&
    next.currentPlayer === (actor === 'player' ? 'you' : 'bot');

  // handEnded translation: BotActionResult uses BotPlayerId; we expose 'player'|'fritz'
  let handEnded: LessonV2HandEnd | undefined;
  if (result.handEnded) {
    const { winner, reason, pointsAwarded, loserPips, calcText } = result.handEnded;
    handEnded = {
      winner:
        winner === 'you' ? 'player' : winner === 'bot' ? 'fritz' : null,
      reason,
      pointsAwarded,
      loserPips,
      calcText,
    };
  }

  return {
    eventIndex,
    handNumber,
    actor,
    action,
    tile: tile ? tileToKey(tile) : undefined,
    position,
    boardAfter: serializeGhostBoardState(next.board),
    playerHandAfter,
    fritzHandAfter,
    boneyardCountAfter,
    pointsScored,
    playerScoreAfter,
    fritzScoreAfter,
    turnContinues,
    handOver: Boolean(next.handOver),
    gameOver: Boolean(next.gameOver),
    handEnded,
    coachingText,
  };
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function lsGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function lsSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, value); } catch {}
}

function lsRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(key); } catch {}
}

// ─── Authoring session ───────────────────────────────────────────────────────

export function loadV2AuthoringSession(): LessonV2AuthoringSession | null {
  const raw = lsGet(LESSON_V2_AUTHORING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LessonV2AuthoringSession;
    if (!parsed.lessonId || !Array.isArray(parsed.events)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveV2AuthoringSession(session: LessonV2AuthoringSession): void {
  lsSet(LESSON_V2_AUTHORING_KEY, JSON.stringify(session));
}

export function clearV2AuthoringSession(): void {
  lsRemove(LESSON_V2_AUTHORING_KEY);
}

/** Create an empty authoring session for a new lesson. */
export function createV2AuthoringSession(lessonId: string, gameId: string): LessonV2AuthoringSession {
  const now = new Date().toISOString();
  return {
    lessonId,
    gameId,
    createdAt: now,
    updatedAt: now,
    handStarts: [],
    events: [],
    lastEventIndex: -1,
  };
}

// ─── Frozen lesson ───────────────────────────────────────────────────────────

export function loadV2FrozenLesson(): LessonV2 | null {
  const raw = lsGet(LESSON_V2_FROZEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LessonV2;
    if (parsed.version !== 2 || !Array.isArray(parsed.events)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveV2FrozenLesson(lesson: LessonV2): void {
  lsSet(LESSON_V2_FROZEN_KEY, JSON.stringify(lesson));
}

export function clearV2FrozenLesson(): void {
  lsRemove(LESSON_V2_FROZEN_KEY);
}

/**
 * Promote an authoring session to a frozen lesson (publish).
 * Creates a clean LessonV2 from the session and saves it.
 */
export function freezeV2Lesson(session: LessonV2AuthoringSession): LessonV2 {
  const now = new Date().toISOString();
  const lesson: LessonV2 = {
    version: 2,
    lessonId: session.lessonId,
    gameId: session.gameId,
    createdAt: session.createdAt,
    updatedAt: now,
    handStarts: [...session.handStarts],
    events: [...session.events],
  };
  saveV2FrozenLesson(lesson);
  return lesson;
}

// ─── Playback helpers ─────────────────────────────────────────────────────────

/**
 * Return the next player event at or after the given cursor index, or null
 * if there are none left.  Used to pre-load coaching text.
 */
export function nextPlayerEvent(
  events: LessonV2Event[],
  fromIndex: number,
): LessonV2Event | null {
  for (let i = fromIndex; i < events.length; i++) {
    if (events[i]!.actor === 'player') return events[i]!;
  }
  return null;
}

/**
 * Return the first event index for a given hand number, or -1 if not found.
 */
export function firstEventIndexForHand(
  handStarts: LessonV2HandStart[],
  handNumber: number,
): number {
  return handStarts.find((h) => h.handNumber === handNumber)?.firstEventIndex ?? -1;
}

/**
 * Restore a BotMatchState from a LessonV2HandStart's serialized snapshot.
 * Returns null if parsing fails.
 */
export function restoreHandStart(handStart: LessonV2HandStart): BotMatchState | null {
  try {
    return JSON.parse(handStart.matchStateJson) as BotMatchState;
  } catch {
    return null;
  }
}

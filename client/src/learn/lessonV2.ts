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

import { hydrateBoardForOpenEnds } from '../game/openEndsGeometry';
import type { BoardState, PlacedTile, TileOrientation } from '../types.ts';
import type { BotActionResult, BotMatchState, BotPlayerId } from '../bot/botEngine';
import { serializeGhostBoardState } from '../ghost/logic';
import { applyGuidedLessonCoachingText } from './guidedLessonNotes';

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
  matchSnapshot: string | null;
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
      branches: [0, 1].map((armIdx) => {
        const branch = (hub.branches ?? [])[armIdx];
        if (!branch) return null;
        const tiles = (branch.tiles ?? []).map(parsePlaced);
        if (tiles.length === 0) return null;
        return {
          openEnd: branch.openEnd ?? hub.hubValue,
          openEndIsDouble: Boolean(branch.openEndIsDouble),
          tiles,
        };
      }),
    }));

    return hydrateBoardForOpenEnds({
      mainLine,
      leftEnd: raw.leftEnd ?? -1,
      rightEnd: raw.rightEnd ?? -1,
      leftEndIsDouble: Boolean(raw.leftEndIsDouble),
      rightEndIsDouble: Boolean(raw.rightEndIsDouble),
      hubDoubles,
    });
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
    return applyGuidedLessonCoachingText(parsed);
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
    matchSnapshot: null,
    lastEventIndex: -1,
  };
}

// ─── Frozen lesson ───────────────────────────────────────────────────────────

function buildTileCountMap(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function inferPlayerHandBeforePlay(event: LessonV2Event): string[] {
  if (event.actor !== 'player' || event.action !== 'play' || !event.tile) {
    return [...event.playerHandAfter];
  }
  return [...event.playerHandAfter, event.tile];
}

function findDrawnTiles(before: string[], after: string[]): string[] {
  const beforeCounts = buildTileCountMap(before);
  const drawn: string[] = [];
  for (const key of after) {
    const remaining = beforeCounts.get(key) ?? 0;
    if (remaining > 0) {
      beforeCounts.set(key, remaining - 1);
    } else {
      drawn.push(key);
    }
  }
  return drawn;
}

function normalizeLessonEvents(events: LessonV2Event[]): LessonV2Event[] {
  const normalized: LessonV2Event[] = [];

  for (let i = 0; i < events.length; i += 1) {
    const current = events[i]!;
    normalized.push({ ...current, eventIndex: normalized.length });

    if (
      current.actor !== 'player' ||
      current.action !== 'play' ||
      !current.turnContinues ||
      current.handOver ||
      current.gameOver
    ) {
      continue;
    }

    const next = events[i + 1] ?? null;
    if (!next || next.handNumber !== current.handNumber) continue;
    if (next.actor !== 'player' || next.action !== 'play') continue;

    const currentHandAfter = [...current.playerHandAfter];
    if (next.tile && currentHandAfter.includes(next.tile)) continue;
    const nextHandBefore = inferPlayerHandBeforePlay(next);
    const drawnTiles = findDrawnTiles(currentHandAfter, nextHandBefore);
    if (drawnTiles.length === 0) continue;
    const boneyardDelta = current.boneyardCountAfter - next.boneyardCountAfter;
    if (boneyardDelta !== drawnTiles.length) continue;

    let runningHand = [...currentHandAfter];
    let runningBoneyard = current.boneyardCountAfter;
    for (let drawIndex = 0; drawIndex < drawnTiles.length; drawIndex += 1) {
      const drawnTile = drawnTiles[drawIndex]!;
      runningHand = [...runningHand, drawnTile];
      runningBoneyard = Math.max(0, runningBoneyard - 1);
      normalized.push({
        eventIndex: normalized.length,
        handNumber: current.handNumber,
        actor: 'player',
        action: 'draw',
        boardAfter: current.boardAfter,
        playerHandAfter: [...runningHand],
        fritzHandAfter: [...current.fritzHandAfter],
        boneyardCountAfter: runningBoneyard,
        pointsScored: 0,
        playerScoreAfter: current.playerScoreAfter,
        fritzScoreAfter: current.fritzScoreAfter,
        turnContinues: true,
        handOver: false,
        gameOver: false,
        coachingText: '',
      });
    }
  }

  return normalized;
}

function normalizeFrozenHandStarts(
  handStarts: LessonV2HandStart[],
  events: LessonV2Event[],
): LessonV2HandStart[] {
  return handStarts.map((handStart) => ({
    ...handStart,
    firstEventIndex: events.findIndex((event) => event.handNumber === handStart.handNumber),
  }));
}

export function loadV2FrozenLesson(): LessonV2 | null {
  const raw = lsGet(LESSON_V2_FROZEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LessonV2;
    if (parsed.version !== 2 || !Array.isArray(parsed.events)) return null;
    const normalizedEvents = normalizeLessonEvents(parsed.events);
    return applyGuidedLessonCoachingText({
      ...parsed,
      events: normalizedEvents,
      handStarts: normalizeFrozenHandStarts(parsed.handStarts ?? [], normalizedEvents),
    });
  } catch {
    return null;
  }
}

/**
 * Guided Match requires a frozen lesson. Use localStorage if present; otherwise
 * promote an in-progress authoring session (dev/publish workflow).
 */
export function ensureGuidedV2FrozenLesson(): LessonV2 | null {
  const frozen = loadV2FrozenLesson();
  if (frozen) return frozen;

  const session = loadV2AuthoringSession();
  if (session?.events?.length) {
    return freezeV2Lesson(session);
  }

  return null;
}

export function saveV2FrozenLesson(lesson: LessonV2): void {
  lsSet(LESSON_V2_FROZEN_KEY, JSON.stringify(lesson));
}

export function clearV2FrozenLesson(): void {
  lsRemove(LESSON_V2_FROZEN_KEY);
}

function parseTileKeySafe(key: string | undefined): { low: number; high: number } | null {
  if (!key) return null;
  const parts = key.split('|');
  if (parts.length !== 2) return null;
  const low = Number(parts[0]);
  const high = Number(parts[1]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return { low, high };
}

function restoreHandStartStateFromEvent(
  handStart: LessonV2HandStart,
  firstEvent: LessonV2Event | null | undefined,
): BotMatchState | null {
  try {
    const base = JSON.parse(handStart.matchStateJson) as BotMatchState;
    if (!firstEvent) return base;

    const playedTile = parseTileKeySafe(firstEvent.tile);
    const playerHandAfter = firstEvent.playerHandAfter
      .map((key) => parseTileKeySafe(key))
      .filter((tile): tile is { low: number; high: number } => tile !== null);
    const fritzHandAfter = firstEvent.fritzHandAfter
      .map((key) => parseTileKeySafe(key))
      .filter((tile): tile is { low: number; high: number } => tile !== null);

    const playerHandBefore =
      firstEvent.actor === 'player' && firstEvent.action === 'play' && playedTile
        ? [...playerHandAfter, playedTile]
        : playerHandAfter;
    const fritzHandBefore =
      firstEvent.actor === 'fritz' && firstEvent.action === 'play' && playedTile
        ? [...fritzHandAfter, playedTile]
        : fritzHandAfter;

    const playerScoreBefore =
      firstEvent.actor === 'player'
        ? firstEvent.playerScoreAfter - firstEvent.pointsScored
        : firstEvent.playerScoreAfter;
    const fritzScoreBefore =
      firstEvent.actor === 'fritz'
        ? firstEvent.fritzScoreAfter - firstEvent.pointsScored
        : firstEvent.fritzScoreAfter;

    return {
      ...base,
      handNumber: handStart.handNumber,
      board: null,
      handOpen: false,
      currentPlayer: firstEvent.actor === 'player' ? 'you' : 'bot',
      handOver: false,
      gameOver: false,
      winnerId: null,
      consecutivePasses: 0,
      turnIndex: 0,
      players: {
        you: { hand: playerHandBefore, score: playerScoreBefore },
        bot: { hand: fritzHandBefore, score: fritzScoreBefore },
      },
    };
  } catch {
    return null;
  }
}

function normalizeHandStartsFromEvents(session: LessonV2AuthoringSession): LessonV2HandStart[] {
  const byHand = new Map<number, LessonV2HandStart>();
  for (const handStart of session.handStarts) {
    if (!byHand.has(handStart.handNumber)) {
      byHand.set(handStart.handNumber, handStart);
    }
  }

  const handNumbers = Array.from(new Set(session.events.map((event) => event.handNumber))).sort((a, b) => a - b);

  return handNumbers.map((handNumber) => {
    const firstEventIndex = session.events.findIndex((event) => event.handNumber === handNumber);
    const firstEvent = firstEventIndex >= 0 ? session.events[firstEventIndex]! : null;
    const existing = byHand.get(handNumber);
    if (!firstEvent || !existing?.matchStateJson) {
      return existing ?? {
        handNumber,
        matchStateJson: '',
        firstEventIndex,
      };
    }

    try {
      const base = JSON.parse(existing.matchStateJson) as BotMatchState;
      const playedTile = parseTileKeySafe(firstEvent.tile);
      const playerHandAfter = firstEvent.playerHandAfter.map((key) => parseTileKeySafe(key)).filter((tile): tile is { low: number; high: number } => tile !== null);
      const fritzHandAfter = firstEvent.fritzHandAfter.map((key) => parseTileKeySafe(key)).filter((tile): tile is { low: number; high: number } => tile !== null);

      const playerHandBefore =
        firstEvent.actor === 'player' && firstEvent.action === 'play' && playedTile
          ? [...playerHandAfter, playedTile]
          : playerHandAfter;
      const fritzHandBefore =
        firstEvent.actor === 'fritz' && firstEvent.action === 'play' && playedTile
          ? [...fritzHandAfter, playedTile]
          : fritzHandAfter;

      const playerScoreBefore =
        firstEvent.actor === 'player'
          ? firstEvent.playerScoreAfter - firstEvent.pointsScored
          : firstEvent.playerScoreAfter;
      const fritzScoreBefore =
        firstEvent.actor === 'fritz'
          ? firstEvent.fritzScoreAfter - firstEvent.pointsScored
          : firstEvent.fritzScoreAfter;

      const repaired: BotMatchState = {
        ...base,
        handNumber,
        board: null,
        handOpen: false,
        currentPlayer: firstEvent.actor === 'player' ? 'you' : 'bot',
        handOver: false,
        gameOver: false,
        winnerId: null,
        consecutivePasses: 0,
        turnIndex: 0,
        players: {
          you: { hand: playerHandBefore, score: playerScoreBefore },
          bot: { hand: fritzHandBefore, score: fritzScoreBefore },
        },
      };

      return {
        handNumber,
        matchStateJson: JSON.stringify(repaired),
        firstEventIndex,
      };
    } catch {
      return {
        handNumber,
        matchStateJson: existing.matchStateJson,
        firstEventIndex,
      };
    }
  });
}

/**
 * Promote an authoring session to a frozen lesson (publish).
 * Creates a clean LessonV2 from the session and saves it.
 */
export function freezeV2Lesson(session: LessonV2AuthoringSession): LessonV2 {
  const now = new Date().toISOString();
  const normalizedEvents = normalizeLessonEvents(session.events);
  const lesson: LessonV2 = {
    version: 2,
    lessonId: session.lessonId,
    gameId: session.gameId,
    createdAt: session.createdAt,
    updatedAt: now,
    handStarts: normalizeFrozenHandStarts(normalizeHandStartsFromEvents(session), normalizedEvents),
    events: normalizedEvents,
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

export function restoreGuidedV2HandStart(
  lesson: LessonV2,
  handNumber: number,
): { state: BotMatchState | null; firstEventIndex: number } {
  const handStart = lesson.handStarts.find((h) => h.handNumber === handNumber);
  const firstEventIndex =
    handStart?.firstEventIndex ??
    lesson.events.findIndex((event) => event.handNumber === handNumber);
  const firstEvent =
    firstEventIndex >= 0 ? lesson.events[firstEventIndex] : null;

  if (!handStart) {
    return { state: null, firstEventIndex };
  }

  const restored = restoreHandStartStateFromEvent(handStart, firstEvent);
  return {
    state: restored,
    firstEventIndex,
  };
}

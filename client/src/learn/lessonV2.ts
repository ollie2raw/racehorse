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
import {
  AUTHORING_GAME_ID,
  AUTHORING_LESSON_ID,
  AUTHORING_STORAGE_KEY,
  FROZEN_LESSON_KEY,
  ORIGINAL_COACHED_TRANSCRIPT_DRAFT_KEY,
  ORIGINAL_COACHED_TRANSCRIPT_KEY,
  hasPlayableV1GuidedContent,
} from './guidedAuthoring';
import { applyGuidedLessonCoachingText } from './guidedLessonNotes';
import { getPublicGuidedMatchLessonSanityIssues, getPublicGuidedMatchPlaybackLesson } from './guidedMatch/guidedMatchLessonLoader';

// ─── Storage keys ────────────────────────────────────────────────────────────

export const LESSON_V2_AUTHORING_KEY = 'racehorse:lesson-v2:authoring:v1';
export const LESSON_V2_FROZEN_KEY = 'racehorse:lesson-v2:frozen:v1';

/** All localStorage keys used for guided lesson data (DevTools → Application → Local Storage). */
export const GUIDED_LESSON_STORAGE_KEYS = {
  v2Authoring: LESSON_V2_AUTHORING_KEY,
  v2Frozen: LESSON_V2_FROZEN_KEY,
  v1Authoring: AUTHORING_STORAGE_KEY,
  v1Frozen: FROZEN_LESSON_KEY,
  v1Transcript: ORIGINAL_COACHED_TRANSCRIPT_KEY,
  v1TranscriptDraft: ORIGINAL_COACHED_TRANSCRIPT_DRAFT_KEY,
} as const;

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
  /** Optional short copy for the coach card preview; full tip uses coachingText body. */
  coachingSummary?: string;
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

function handStartHasSnapshot(handStart: LessonV2HandStart | null | undefined): boolean {
  return Boolean(handStart?.matchStateJson?.trim());
}

function v2LessonHasStartableContent(lesson: LessonV2 | null): boolean {
  if (!lesson) return false;
  if (Array.isArray(lesson.events) && lesson.events.length > 0) return true;
  return lesson.handStarts?.some(handStartHasSnapshot) ?? false;
}

function v2AuthoringSessionHasStartableContent(session: LessonV2AuthoringSession | null): boolean {
  if (!session) return false;
  if (session.events?.length) return true;
  if (session.handStarts?.some(handStartHasSnapshot)) return true;
  return Boolean(session.matchSnapshot?.trim());
}

function normalizeV2AuthoringSession(raw: unknown): LessonV2AuthoringSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Record<string, unknown>;

  if (parsed.version === 2 && Array.isArray(parsed.events)) {
    const frozenLike = parsed as unknown as LessonV2;
    return {
      lessonId:
        typeof frozenLike.lessonId === 'string' && frozenLike.lessonId.trim()
          ? frozenLike.lessonId
          : AUTHORING_LESSON_ID,
      gameId:
        typeof frozenLike.gameId === 'string' && frozenLike.gameId.trim()
          ? frozenLike.gameId
          : AUTHORING_GAME_ID,
      createdAt: typeof frozenLike.createdAt === 'string' ? frozenLike.createdAt : new Date().toISOString(),
      updatedAt: typeof frozenLike.updatedAt === 'string' ? frozenLike.updatedAt : new Date().toISOString(),
      handStarts: Array.isArray(frozenLike.handStarts) ? frozenLike.handStarts : [],
      events: frozenLike.events,
      matchSnapshot: null,
      lastEventIndex: frozenLike.events.length > 0 ? frozenLike.events.length - 1 : -1,
    };
  }

  const events = Array.isArray(parsed.events) ? (parsed.events as LessonV2Event[]) : [];
  const handStarts = Array.isArray(parsed.handStarts) ? (parsed.handStarts as LessonV2HandStart[]) : [];
  const matchSnapshot = typeof parsed.matchSnapshot === 'string' ? parsed.matchSnapshot : null;

  if (!events.length && !handStarts.some(handStartHasSnapshot) && !matchSnapshot?.trim()) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    lessonId:
      typeof parsed.lessonId === 'string' && parsed.lessonId.trim() ? parsed.lessonId : AUTHORING_LESSON_ID,
    gameId: typeof parsed.gameId === 'string' && parsed.gameId.trim() ? parsed.gameId : AUTHORING_GAME_ID,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : now,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : now,
    handStarts,
    events,
    matchSnapshot,
    lastEventIndex:
      typeof parsed.lastEventIndex === 'number' && Number.isFinite(parsed.lastEventIndex)
        ? parsed.lastEventIndex
        : events.length > 0
          ? events.length - 1
          : -1,
  };
}

function debugGuidedStart(message: string, detail?: unknown): void {
  if (import.meta.env.DEV) {
    console.warn('[guided-match-start]', message, detail ?? '');
  }
}

export type GuidedV2StartFailure =
  | 'no-storage'
  | 'unreadable-v2-authoring'
  | 'unreadable-v2-frozen'
  | 'no-startable-content'
  | 'playback-restore-failed';

export function probeGuidedLessonStorage(): Record<keyof typeof GUIDED_LESSON_STORAGE_KEYS, 'missing' | 'empty' | 'present'> {
  const read = (key: string): 'missing' | 'empty' | 'present' => {
    const raw = lsGet(key);
    if (raw === null) return 'missing';
    if (!raw.trim()) return 'empty';
    return 'present';
  };
  return {
    v2Authoring: read(LESSON_V2_AUTHORING_KEY),
    v2Frozen: read(LESSON_V2_FROZEN_KEY),
    v1Authoring: read(AUTHORING_STORAGE_KEY),
    v1Frozen: read(FROZEN_LESSON_KEY),
    v1Transcript: read(ORIGINAL_COACHED_TRANSCRIPT_KEY),
    v1TranscriptDraft: read(ORIGINAL_COACHED_TRANSCRIPT_DRAFT_KEY),
  };
}

export function loadV2AuthoringSession(): LessonV2AuthoringSession | null {
  const raw = lsGet(LESSON_V2_AUTHORING_KEY);
  if (!raw) return null;
  try {
    const session = normalizeV2AuthoringSession(JSON.parse(raw));
    if (!session) return null;
    return applyGuidedLessonCoachingText(session);
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
    if (parsed.version !== 2) return null;
    const events = Array.isArray(parsed.events) ? parsed.events : [];
    const handStarts = Array.isArray(parsed.handStarts) ? parsed.handStarts : [];
    if (!events.length && !handStarts.some(handStartHasSnapshot)) return null;
    const normalizedEvents = normalizeLessonEvents(events);
    const lesson: LessonV2 = {
      version: 2,
      lessonId:
        typeof parsed.lessonId === 'string' && parsed.lessonId.trim() ? parsed.lessonId : AUTHORING_LESSON_ID,
      gameId: typeof parsed.gameId === 'string' && parsed.gameId.trim() ? parsed.gameId : AUTHORING_GAME_ID,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      handStarts: normalizeFrozenHandStarts(handStarts, normalizedEvents),
      events: normalizedEvents,
    };
    return applyGuidedLessonCoachingText(lesson);
  } catch {
    return null;
  }
}

/** Auto-promote authoring → frozen before Guided Match (Learn hub play click). */
export function autoFreezeGuidedV2ForPlay(): LessonV2 | null {
  const session = loadV2AuthoringSession();
  if (v2AuthoringSessionHasStartableContent(session)) {
    return freezeV2Lesson(session!);
  }
  return loadV2FrozenLesson();
}

/**
 * Guided Match playback: frozen lesson, auto-promoted from authoring when needed.
 */
export function loadGuidedV2PlaybackLesson(): LessonV2 | null {
  try {
    return getPublicGuidedMatchPlaybackLesson();
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[guided-match-public-lesson] failed to load bundled lesson', error);
    }
    return null;
  }
}

/**
 * Prefer frozen when startable; otherwise promote authoring (events, handStarts, or snapshot).
 */
export function ensureGuidedV2FrozenLesson(): LessonV2 | null {
  const session = loadV2AuthoringSession();
  if (v2AuthoringSessionHasStartableContent(session)) {
    return freezeV2Lesson(session!);
  }

  const frozen = loadV2FrozenLesson();
  if (frozen && v2LessonHasStartableContent(frozen)) {
    return frozen;
  }

  return null;
}

/** True when the hub can launch Guided Match V2 (does not require playback restore). */
export function canStartGuidedV2Lesson(lesson: LessonV2 | null): boolean {
  return v2LessonHasStartableContent(lesson);
}

export type GuidedMatchStartRoute = 'v2' | 'v1';

export interface GuidedMatchStartResolution {
  route: GuidedMatchStartRoute | null;
  /** Set when route is null — user-facing message for Learn hub / guards */
  error: string | null;
  /** Dev-only hint for which gate failed */
  failure?: GuidedV2StartFailure;
}

function messageForGuidedStartFailure(
  failure: GuidedV2StartFailure,
  playbackError: string | null,
): string {
  switch (failure) {
    case 'no-storage':
      return 'No guided lesson found in this browser. Author in Learn admin (V2 authoring) or restore localStorage.';
    case 'unreadable-v2-authoring':
      return 'V2 authoring data is saved but could not be read. Check racehorse:lesson-v2:authoring:v1 in DevTools → Application → Local Storage.';
    case 'unreadable-v2-frozen':
      return 'A frozen V2 lesson exists but could not be read. Re-freeze from Learn admin or fix racehorse:lesson-v2:frozen:v1.';
    case 'no-startable-content':
      return 'Guided lesson storage is present but has no events, hand snapshots, or V1 moves yet. Record at least one hand in V2 authoring.';
    case 'playback-restore-failed':
      return (
        playbackError ??
        'Could not restore the lesson opening from frozen data. Re-open V2 authoring and record hand 1 again.'
      );
    default:
      return 'Guided Match could not start.';
  }
}

/**
 * Resolve how Guided Match should boot: V2 frozen/authoring first, else V1 sources.
 * Auto-freezes authoring before validation.
 */
export function resolveGuidedMatchStart(): GuidedMatchStartResolution {
  const v2Lesson = loadGuidedV2PlaybackLesson();
  const sanityIssues = getPublicGuidedMatchLessonSanityIssues();
  const playbackError = validateGuidedV2LessonPlayback(v2Lesson);

  if (canStartGuidedV2Lesson(v2Lesson) && playbackError === null) {
    return { route: 'v2', error: null };
  }

  debugGuidedStart('bundled public lesson unavailable', { playbackError, sanityIssues });
  return {
    route: null,
    error:
      playbackError ??
      (sanityIssues.length > 0
        ? `Bundled Guided Match lesson failed sanity checks: ${sanityIssues.join('; ')}`
        : 'Bundled Guided Match lesson is unavailable.'),
    failure: 'playback-restore-failed',
  };
}

/** Strict playback validation (in-match cursor / board restore). */
export function validateGuidedV2LessonPlayback(lesson: LessonV2 | null): string | null {
  if (!lesson) {
    return 'No guided lesson is loaded.';
  }
  if (!Array.isArray(lesson.events) || lesson.events.length === 0) {
    if (lesson.handStarts?.some(handStartHasSnapshot)) {
      const playback = initGuidedV2Playback(lesson, 1);
      if (!playback.state) {
        return 'Could not restore the lesson opening position from hand snapshots.';
      }
      return null;
    }
    return 'The frozen lesson has no recorded moves or hand snapshots.';
  }
  const playback = initGuidedV2Playback(lesson, 1);
  if (!playback.state) {
    return 'Could not restore the lesson opening position from frozen data.';
  }
  return null;
}

/**
 * Hub / boot gate: startable content only (no initGuidedV2Playback check).
 * @deprecated Prefer canStartGuidedV2Lesson + validateGuidedV2LessonPlayback at runtime.
 */
export function validateGuidedV2Lesson(lesson: LessonV2 | null): string | null {
  if (!canStartGuidedV2Lesson(lesson)) {
    if (!lesson) {
      return messageForGuidedStartFailure('no-storage', null);
    }
    return messageForGuidedStartFailure('no-startable-content', null);
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

function tilesFromKeys(keys: string[]): { low: number; high: number }[] {
  return keys
    .map((key) => parseTileKeySafe(key))
    .filter((tile): tile is { low: number; high: number } => tile !== null);
}

function placeholderBoneyard(count: number): { low: number; high: number }[] {
  return Array.from({ length: Math.max(0, count) }, () => ({ low: 0, high: 0 }));
}

function handsBeforeFirstEvent(firstEvent: LessonV2Event): {
  playerHand: { low: number; high: number }[];
  fritzHand: { low: number; high: number }[];
  playerScore: number;
  fritzScore: number;
  currentPlayer: BotPlayerId;
} {
  const playedTile = parseTileKeySafe(firstEvent.tile);
  const playerHandAfter = tilesFromKeys(firstEvent.playerHandAfter);
  const fritzHandAfter = tilesFromKeys(firstEvent.fritzHandAfter);

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
    playerHand: playerHandBefore,
    fritzHand: fritzHandBefore,
    playerScore: playerScoreBefore,
    fritzScore: fritzScoreBefore,
    currentPlayer: firstEvent.actor === 'player' ? 'you' : 'bot',
  };
}

/** Hand-start shell derived only from frozen event fields — no random deal. */
function createGuidedEventDerivedShell(
  handNumber: number,
  firstEvent: LessonV2Event,
): BotMatchState {
  const { playerHand, fritzHand, playerScore, fritzScore, currentPlayer } =
    handsBeforeFirstEvent(firstEvent);

  return {
    players: {
      you: { hand: playerHand, score: playerScore },
      bot: { hand: fritzHand, score: fritzScore },
    },
    board: null,
    boneyard: placeholderBoneyard(firstEvent.boneyardCountAfter),
    deadTiles: [],
    handOpen: false,
    currentPlayer,
    consecutivePasses: 0,
    handNumber,
    turnIndex: 0,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 60,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
    opponentPassedOnEnds: [],
    opponentDrawCount: 0,
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
  };
}

function restoreHandStartStateFromEvent(
  handStart: LessonV2HandStart | null | undefined,
  firstEvent: LessonV2Event | null | undefined,
  handNumber: number,
): BotMatchState | null {
  let base: BotMatchState | null = null;
  if (handStart?.matchStateJson?.trim()) {
    try {
      base = JSON.parse(handStart.matchStateJson) as BotMatchState;
    } catch {
      base = null;
    }
  }
  if (!base && firstEvent) {
    base = createGuidedEventDerivedShell(handNumber, firstEvent);
  }
  if (!base) return null;
  if (!firstEvent) {
    return {
      ...base,
      handNumber,
      board: null,
      handOpen: false,
      handOver: false,
      gameOver: false,
      winnerId: null,
      consecutivePasses: 0,
    };
  }

  const { playerHand, fritzHand, playerScore, fritzScore, currentPlayer } =
    handsBeforeFirstEvent(firstEvent);

  return {
    ...base,
    handNumber,
    board: null,
    handOpen: false,
    currentPlayer,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    turnIndex: 0,
    boneyard: placeholderBoneyard(firstEvent.boneyardCountAfter),
    players: {
      you: { hand: playerHand, score: playerScore },
      bot: { hand: fritzHand, score: fritzScore },
    },
  };
}

function normalizeHandStartsFromEvents(session: LessonV2AuthoringSession): LessonV2HandStart[] {
  const byHand = new Map<number, LessonV2HandStart>();
  for (const handStart of session.handStarts) {
    if (!byHand.has(handStart.handNumber)) {
      byHand.set(handStart.handNumber, handStart);
    }
  }

  const handNumbers = Array.from(
    new Set([
      ...session.handStarts.map((handStart) => handStart.handNumber),
      ...session.events.map((event) => event.handNumber),
      ...(session.matchSnapshot?.trim() ? [1] : []),
    ]),
  ).sort((a, b) => a - b);

  return handNumbers.map((handNumber) => {
    const firstEventIndex = session.events.findIndex((event) => event.handNumber === handNumber);
    const firstEvent = firstEventIndex >= 0 ? session.events[firstEventIndex]! : null;
    const existing =
      byHand.get(handNumber) ??
      (handNumber === 1 && session.matchSnapshot?.trim()
        ? {
            handNumber: 1,
            matchStateJson: session.matchSnapshot,
            firstEventIndex: firstEventIndex >= 0 ? firstEventIndex : 0,
          }
        : undefined);
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
  const handStart = lesson.handStarts.find((h) => h.handNumber === handNumber) ?? null;
  const firstEventIndex =
    handStart?.firstEventIndex ??
    lesson.events.findIndex((event) => event.handNumber === handNumber);
  const firstEvent =
    firstEventIndex >= 0 ? lesson.events[firstEventIndex] : null;

  const restored = restoreHandStartStateFromEvent(
    handStart ?? { handNumber, matchStateJson: '', firstEventIndex: Math.max(0, firstEventIndex) },
    firstEvent,
    handNumber,
  );
  return {
    state: restored,
    firstEventIndex: Math.max(0, firstEventIndex),
  };
}

/**
 * Reconstruct match state immediately before events[eventIndex] is applied.
 * Uses the previous event's authoritative board/hand fields when available.
 */
export function restoreMatchStateBeforeEvent(
  lesson: LessonV2,
  eventIndex: number,
): BotMatchState | null {
  if (eventIndex <= 0) {
    const handNumber = lesson.events[0]?.handNumber ?? 1;
    return restoreGuidedV2HandStart(lesson, handNumber).state;
  }

  const atEvent = lesson.events[eventIndex];
  const prev = lesson.events[eventIndex - 1];
  if (!atEvent || !prev) {
    const handNumber = atEvent?.handNumber ?? lesson.events[0]?.handNumber ?? 1;
    return restoreGuidedV2HandStart(lesson, handNumber).state;
  }

  const firstEventIndexForCurrentHand = firstEventIndexForHand(lesson.handStarts, atEvent.handNumber);
  if (atEvent.handNumber !== prev.handNumber || firstEventIndexForCurrentHand === eventIndex) {
    return (
      restoreGuidedV2HandStart(lesson, atEvent.handNumber).state ??
      createGuidedEventDerivedShell(atEvent.handNumber, atEvent)
    );
  }

  const shell =
    restoreGuidedV2HandStart(lesson, atEvent.handNumber).state ??
    createGuidedEventDerivedShell(atEvent.handNumber, atEvent);

  const board = parseLessonV2BoardState(prev.boardAfter);
  const playerHand = tilesFromKeys(prev.playerHandAfter);
  const fritzHand = tilesFromKeys(prev.fritzHandAfter);

  return {
    ...shell,
    handNumber: atEvent.handNumber,
    board,
    handOpen: Boolean(board?.mainLine?.length),
    boneyard: placeholderBoneyard(prev.boneyardCountAfter),
    players: {
      you: { hand: playerHand, score: prev.playerScoreAfter },
      bot: { hand: fritzHand, score: prev.fritzScoreAfter },
    },
    currentPlayer: atEvent.actor === 'player' ? 'you' : 'bot',
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    turnIndex: shell.turnIndex ?? 0,
  };
}

/** Guided Match entry: hand-start snapshot plus board/hands before the first event. */
export function initGuidedV2Playback(
  lesson: LessonV2,
  handNumber = 1,
): { state: BotMatchState | null; firstEventIndex: number } {
  const { firstEventIndex } = restoreGuidedV2HandStart(lesson, handNumber);
  const idx = Math.max(0, firstEventIndex);
  const state =
    restoreMatchStateBeforeEvent(lesson, idx) ??
    restoreGuidedV2HandStart(lesson, handNumber).state;
  return { state, firstEventIndex: idx };
}

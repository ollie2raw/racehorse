/**
 * learn/guidedAuthoring.ts
 *
 * Types, seeded deal generation, and localStorage helpers for Guided Authoring.
 *
 * Every hand in the authoring game is derived from the same fixed root seed
 * using an LCG PRNG + Fisher-Yates shuffle — identical algorithm to the server
 * (dailyFritz.ts). The sequence is therefore fully deterministic:
 *   hand 0 (first)  → seed 'guided-authoring-lesson-001:hand:0'
 *   hand 1          → seed 'guided-authoring-lesson-001:hand:1'
 *   hand N          → seed 'guided-authoring-lesson-001:hand:N'
 *
 * The same game plays out on every fresh start, every reload, every replay.
 */

import type { BotHandDeal } from '../bot/botEngine';

// ─── Identifiers ────────────────────────────────────────────────────────────

export const AUTHORING_LESSON_ID = 'lesson-001';
export const AUTHORING_GAME_ID = 'game-fixed-elite-001';
export const AUTHORING_STORAGE_KEY = 'racehorse:guided-authoring:v1';
export const FROZEN_LESSON_KEY = 'racehorse:guided-lesson:v1';

/** Root seed shared by all hands in this lesson. Change to version a new game. */
const AUTHORING_ROOT_SEED = 'guided-authoring-lesson-001';

// ─── Seeded PRNG (LCG — identical to server/src/dailyFritz.ts) ──────────────
//
// hashSeedToUint32: FNV-1a 32-bit hash maps any string → stable uint32.
// createSeededPrng:  LCG (Knuth): state = (state * 1664525 + 1013904223) mod 2^32.
// shuffleWithPrng:   Fisher-Yates in-place using the PRNG.
//
// Algorithm parity with the server is intentional: the exact same seed string
// will always produce the exact same deal on both client and server.

function hashSeedToUint32(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededPrng(seed: string): () => number {
  let state = hashSeedToUint32(seed) || 0x9e3779b9;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleWithPrng<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function buildDoubleSixSet(): { low: number; high: number }[] {
  const tiles: { low: number; high: number }[] = [];
  for (let high = 0; high <= 6; high += 1) {
    for (let low = 0; low <= high; low += 1) {
      tiles.push({ low, high });
    }
  }
  return tiles;
}

// ─── Hand deal generation ────────────────────────────────────────────────────

/**
 * Generate the deterministic hand deal for the given 0-based hand index.
 *
 * hand 0 → first hand of the match
 * hand 1 → second hand, etc.
 *
 * The deal is stable: the same index always produces the same tiles.
 */
export function generateAuthoringHandDeal(handIndex: number): BotHandDeal {
  const prng = createSeededPrng(`${AUTHORING_ROOT_SEED}:hand:${handIndex}`);
  const shuffled = shuffleWithPrng(buildDoubleSixSet(), prng);
  const dealSize = 7;
  const remaining = shuffled.slice(dealSize * 2);
  return {
    player_tiles: shuffled.slice(0, dealSize).map((t) => ({ ...t })),
    fritz_tiles: shuffled.slice(dealSize, dealSize * 2).map((t) => ({ ...t })),
    // Last 2 of remaining are locked (same as daily fritz logic)
    boneyard: remaining.map((t) => ({ ...t })),
    locked: remaining.slice(Math.max(0, remaining.length - 2)).map((t) => ({ ...t })),
  };
}

// ─── Data types ──────────────────────────────────────────────────────────────

/**
 * One authored step = one of the player's turns in the fixed game.
 * Step index advances only on player turns, not bot turns.
 */
export interface AuthoredStep {
  /** 0-based index among player turns only */
  stepIndex: number;
  /** Which hand of the match this occurred in */
  handNumber: number;
  /** Serialized board state BEFORE the player's move */
  boardState: string;
  /** Player's hand BEFORE the move, as tile keys ("2|4") */
  playerHand: string[];
  /**
   * Tile played ("2|4" or "2|4:left" / "2|4:right" with position),
   * "draw", "pass", or null if step is note-only draft.
   */
  chosenMove: string | null;
  /** The coaching note the author wrote for this turn */
  coachingText: string;
  /**
   * JSON-stringified BotMatchState BEFORE the player's move.
   * Stored so playback can reconstruct exact board state if needed.
   * Optional — absent in sessions authored before this field was added.
   */
  matchStateJson?: string | null;
}

/**
 * The full authoring session persisted to localStorage.
 */
export interface AuthoringSession {
  lessonId: string;
  fixedGameId: string;
  /** All completed (and draft) authored steps */
  steps: AuthoredStep[];
  /** Number of player turns completed so far */
  currentStepIndex: number;
  /**
   * JSON-stringified BotMatchState snapshot saved after the last player action.
   * Used to restore the exact game position on page reload.
   */
  matchSnapshot: string | null;
}

// ─── localStorage helpers ────────────────────────────────────────────────────

export function loadAuthoringSession(): AuthoringSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTHORING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthoringSession;
    if (!parsed.lessonId || !parsed.fixedGameId || !Array.isArray(parsed.steps)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveAuthoringSession(session: AuthoringSession): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTHORING_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage may be full or unavailable — fail silently
  }
}

export function clearAuthoringSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(AUTHORING_STORAGE_KEY);
  } catch {}
}

// ─── Frozen Lesson (player-facing) ──────────────────────────────────────────

/**
 * A frozen lesson is an authored session that has been promoted for player
 * playback. It is structurally identical to AuthoringSession but stored under
 * a separate key so authoring never overwrites the live lesson.
 */
export type FrozenLesson = AuthoringSession;

export function loadFrozenLesson(): FrozenLesson | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(FROZEN_LESSON_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FrozenLesson;
    if (!parsed.lessonId || !parsed.fixedGameId || !Array.isArray(parsed.steps)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveFrozenLesson(lesson: FrozenLesson): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FROZEN_LESSON_KEY, JSON.stringify(lesson));
  } catch {}
}

export function clearFrozenLesson(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(FROZEN_LESSON_KEY);
  } catch {}
}

// ─── Admin debug ─────────────────────────────────────────────────────────────

export interface LessonStepDebug {
  stepIndex: number;
  playerHand: string[];
  chosenMove: string | null;
  coachingTextPreview: string;
  boardStatePreview: string;
}

export interface LessonDebugSummary {
  storageKey: string;
  present: boolean;
  lessonId?: string;
  fixedGameId?: string;
  stepCount: number;
  firstSteps: LessonStepDebug[];
  /** Summary of the first step's matchStateJson (player hand, bot hand, board empty, scores) */
  matchStateSummary?: {
    playerHand: string[];
    botHand: string[];
    boardEmpty: boolean;
    handNumber: number;
    playerScore: number;
    botScore: number;
  } | null;
}

function debugSteps(steps: AuthoredStep[]): LessonStepDebug[] {
  return steps.slice(0, 3).map((s) => ({
    stepIndex: s.stepIndex,
    playerHand: s.playerHand,
    chosenMove: s.chosenMove,
    coachingTextPreview: s.coachingText.slice(0, 120),
    boardStatePreview: s.boardState.slice(0, 60),
  }));
}

function parseMatchSummary(session: AuthoringSession): LessonDebugSummary['matchStateSummary'] {
  // Try the first step's matchStateJson first, then the session's matchSnapshot
  const firstStepJson = session.steps[0]?.matchStateJson;
  const raw = firstStepJson ?? session.matchSnapshot;
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as {
      players?: {
        you?: { hand?: Array<{ low: number; high: number }>; score?: number };
        bot?: { hand?: Array<{ low: number; high: number }>; score?: number };
      };
      board?: { chain?: unknown[] };
      handNumber?: number;
    };
    const toKeys = (hand: Array<{ low: number; high: number }> | undefined) =>
      (hand ?? []).map((t) => `${t.low}|${t.high}`);
    return {
      playerHand: toKeys(m.players?.you?.hand),
      botHand: toKeys(m.players?.bot?.hand),
      boardEmpty: !m.board?.chain || (m.board.chain as unknown[]).length === 0,
      handNumber: m.handNumber ?? 1,
      playerScore: m.players?.you?.score ?? 0,
      botScore: m.players?.bot?.score ?? 0,
    };
  } catch {
    return null;
  }
}

export function readLessonDebug(): {
  authoring: LessonDebugSummary;
  frozen: LessonDebugSummary;
} {
  const authoringRaw = typeof window !== 'undefined'
    ? window.localStorage.getItem(AUTHORING_STORAGE_KEY)
    : null;
  const frozenRaw = typeof window !== 'undefined'
    ? window.localStorage.getItem(FROZEN_LESSON_KEY)
    : null;

  const parseSession = (raw: string | null): AuthoringSession | null => {
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as AuthoringSession;
      return p.lessonId && Array.isArray(p.steps) ? p : null;
    } catch { return null; }
  };

  const authoring = parseSession(authoringRaw);
  const frozen = parseSession(frozenRaw);

  return {
    authoring: {
      storageKey: AUTHORING_STORAGE_KEY,
      present: !!authoring,
      lessonId: authoring?.lessonId,
      fixedGameId: authoring?.fixedGameId,
      stepCount: authoring?.steps.length ?? 0,
      firstSteps: authoring ? debugSteps(authoring.steps) : [],
      matchStateSummary: authoring ? parseMatchSummary(authoring) : null,
    },
    frozen: {
      storageKey: FROZEN_LESSON_KEY,
      present: !!frozen,
      lessonId: frozen?.lessonId,
      fixedGameId: frozen?.fixedGameId,
      stepCount: frozen?.steps.length ?? 0,
      firstSteps: frozen ? debugSteps(frozen.steps) : [],
      matchStateSummary: frozen ? parseMatchSummary(frozen) : null,
    },
  };
}

/**
 * Compact the frozen lesson in-place:
 *   1. Remove all draft steps (chosenMove === null) — these are stale Note-Only saves
 *      that were never superseded by a real tile-play because the stepIdx shifted.
 *   2. Re-index the remaining steps so stepIndex === position in the cleaned array.
 *   3. Persist the repaired lesson back to localStorage.
 *
 * Returns the number of draft steps that were removed, or null if no lesson exists.
 */
export function compactFrozenLesson(): number | null {
  if (typeof window === 'undefined') return null;
  const lesson = loadFrozenLesson();
  if (!lesson) return null;

  const before = lesson.steps.length;
  const cleaned = lesson.steps
    .filter((s) => s.chosenMove !== null)
    .map((s, i) => ({ ...s, stepIndex: i }));
  const removed = before - cleaned.length;

  saveFrozenLesson({ ...lesson, steps: cleaned, currentStepIndex: cleaned.length });
  return removed;
}

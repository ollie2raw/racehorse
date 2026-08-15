/**
 * Shared hand-over → next-hand lifecycle helpers for bot / Daily Fritz matches.
 * Keeps transition rules explicit and testable.
 */

import type { HandLifecyclePhase, HandLifecycleLogPayload } from '@racehorse/match-protocol';

export type { HandLifecyclePhase, HandLifecycleLogPayload };

const DEV =
  typeof import.meta !== 'undefined' &&
  (import.meta as ImportMeta & { env?: { DEV?: boolean; VITE_DEBUG_HAND_LIFECYCLE?: string } }).env?.DEV === true;

let lastPhase: HandLifecyclePhase = 'playing';

export function resetHandLifecyclePhase(): void {
  lastPhase = 'playing';
}

export function getHandLifecyclePhase(): HandLifecyclePhase {
  return lastPhase;
}

/** True when local state should accept a dealt next hand. */
export function canApplyNextHand(match: { handOver: boolean; gameOver: boolean }): boolean {
  return match.handOver && !match.gameOver;
}

export type BotMatchLifecycleSnapshot = {
  currentPlayer: 'you' | 'bot';
  handOver: boolean;
  gameOver: boolean;
};

/** Fritz may act only on bot turn while the hand and game are still live. */
export function shouldAllowBotAction(match: BotMatchLifecycleSnapshot): boolean {
  return match.currentPlayer === 'bot' && !match.handOver && !match.gameOver;
}

export type BotActionApplySnapshot = {
  handOver: boolean;
  gameOver: boolean;
  handNumber?: number;
};

/**
 * Drop stale bot async results (timer/effect) that would mutate state after the
 * hand or game has already ended in the live match ref.
 */
export function shouldApplyBotActionResult(
  live: BotActionApplySnapshot,
  result: { handEnded?: unknown; state: BotActionApplySnapshot },
): boolean {
  if (
    typeof live.handNumber === 'number'
    && typeof result.state.handNumber === 'number'
    && live.handNumber !== result.state.handNumber
  ) {
    return false;
  }
  if (live.gameOver && !result.state.gameOver) return false;
  if (live.handOver && !result.handEnded) return false;
  return true;
}

/** Daily Fritz set is finished — no further hands or bot actions in the embed. */
export function isDailyFritzSetTerminal(
  setResult: { setWinner?: string | null } | null | undefined,
): boolean {
  return Boolean(setResult?.setWinner);
}

/**
 * Challenge games reuse the hand lifecycle, but the engine can mark a hand
 * over before the fixed-deal game target is reached. That state is a hand
 * transition, not a completed challenge game.
 */
export function isChallengeHandOnlyGameOver(input: {
  gameOver: boolean;
  youScore: number;
  botScore: number;
  winningScore: number | null | undefined;
}): boolean {
  return Boolean(
    input.gameOver
    && typeof input.winningScore === 'number'
    && Math.max(input.youScore, input.botScore) < input.winningScore,
  );
}

/**
 * Hand-end reveal timer fired for an older hand — do not show or replace reveal.
 */
export function shouldShowHandRevealForHand(
  liveHandNumber: number,
  endedHandNumber: number,
): boolean {
  return liveHandNumber === endedHandNumber;
}

/** Pause after the last tile so the board beat lands before the hand-over modal. */
export const DAILY_FRITZ_HAND_REVEAL_DELAY_MS = 2000;
export const DAILY_FRITZ_HAND_AUTO_ADVANCE_MS = 5000;

/**
 * Bot / Daily Fritz hand-over always waits after the final play.
 * `isDailyFritzMode` is kept for call-site clarity; both paths use delayed reveal.
 */
export function resolveHandRevealScheduleMode(_isDailyFritzMode: boolean): 'immediate' | 'delayed' {
  return 'delayed';
}

export function getDailyFritzWatchdogDelayMs(handRevealVisible: boolean): number {
  return handRevealVisible
    ? DAILY_FRITZ_HAND_AUTO_ADVANCE_MS + 4000
    : DAILY_FRITZ_HAND_REVEAL_DELAY_MS + 3000;
}

/** Watchdog may advance only after the hand-result modal has been shown and the countdown gate opens. */
export function shouldDailyFritzWatchdogAdvance(input: {
  handOver: boolean;
  gameOver: boolean;
  challengeHandOnlyGameOver?: boolean;
  handRevealVisible: boolean;
  minAdvanceAt: number | null;
  nowMs: number;
}): boolean {
  if (!input.handOver || (input.gameOver && !input.challengeHandOnlyGameOver)) return false;
  if (!input.handRevealVisible) return false;
  if (isDailyFritzAdvanceLocked(input.minAdvanceAt, input.nowMs)) return false;
  return true;
}

export type DailyFritzHandBreadcrumbEvent =
  | 'reveal-skipped'
  | 'reveal-restored'
  | 'draw-fallback'
  | 'manual-advance-shown'
  | 'next-hand-silent-retry';

/** Production-visible trust breadcrumbs for Daily Fritz hand lifecycle debugging. */
export function logDailyFritzHandBreadcrumb(
  event: DailyFritzHandBreadcrumbEvent,
  detail: Record<string, unknown>,
): void {
  console.log(`[daily-flow] ${event}`, detail);
}

export function logHandLifecycle(payload: HandLifecycleLogPayload): void {
  const previousPhase = payload.previousPhase ?? lastPhase;
  lastPhase = payload.phase;
  if (DEV) {
    const suffix = payload.detail ? ` ${JSON.stringify(payload.detail)}` : '';
    console.log(`[handLifecycle] ${previousPhase} -> ${payload.phase}${suffix}`);
  }
}

export function warnHandLifecycleStuck(
  message: string,
  detail: Record<string, unknown>,
): void {
  if (DEV) {
    console.warn(`[handLifecycle] STUCK: ${message}`, detail);
  }
}

/** Debug-session ingest (no-op in production). */
export type DailyFritzNextHandCache<T> = {
  promise: Promise<T>;
  result: T | null;
  error: unknown;
  startedAt: number;
};

/** Prefer settled prefetch; otherwise await in-flight; otherwise create. */
export async function resolveDailyFritzNextHandCache<T>(
  cache: DailyFritzNextHandCache<T> | null,
  createRequest: () => Promise<T>,
): Promise<T> {
  if (cache?.result) return cache.result;
  if (cache?.promise) {
    // A rejected prefetch (or any failed attempt) leaves `error` set and the
    // same rejected promise on the cache. Retrying must issue a fresh fetch —
    // the server path is idempotent (replayed/ignored responses).
    if (cache.error) return createRequest();
    try {
      return await cache.promise;
    } catch {
      return createRequest();
    }
  }
  return createRequest();
}

/**
 * True while Daily Fritz must keep showing hand-end reveal before advancing.
 */
export function isDailyFritzAdvanceLocked(
  minAdvanceAt: number | null,
  nowMs: number,
): boolean {
  return typeof minAdvanceAt === 'number' && nowMs < minAdvanceAt;
}

export function emitHandLifecycleDebugLog(
  payload: {
    location: string;
    message: string;
    hypothesisId?: string;
    data?: Record<string, unknown>;
    runId?: string;
  },
): void {
  if (!import.meta.env.DEV) return;
  void import('../../../devtools/handLifecycleDebug.ts').then((module) => {
    module.emitHandLifecycleDebugLog(payload);
  });
}

/**
 * The review sweep yields to live play.
 *
 * Review search runs in a worker thread, but on the small instance this server runs on it still shares CPU with the
 * main thread that carries every live match, and the 2026-09-30 / 10-01 outages were exactly that. So no review work is
 * claimed or evaluated while a game is being played, and a job that is already running holds before its next decision.
 *
 *   live play  = a room with a started, unfinished match, at least one connected socket and a match event in the last
 *                `activityWindowMs`. Stored rooms nobody is connected to are not live play.
 *   or         = the event loop is lagging more than `lagThresholdMs` (measured here, over the last few seconds).
 *
 * Reviews must still finish, so after `starvationAfterMs` of continuous live play the gate opens for `sliceOnMs` out of
 * every `slicePeriodMs` (a low duty cycle) until the room goes quiet.
 *
 * A held job is NOT aborted: aborting a pass ends it as pending with a fresh backoff and the claim has already counted an
 * attempt, so aborting would burn attempts. Holding keeps the same claim, and the lease heartbeat keeps renewing it.
 *
 * It fails open: a probe that throws counts as "no live play", and REVIEW_YIELD_TO_LIVE_PLAY_ENABLED=false turns the whole
 * thing off (the review sweep then behaves exactly as before).
 */
import { childLogger } from '../logger';

const log = childLogger('review-yield');

export const REVIEW_YIELD_CONFIG = {
  /** A room is live while its last match event is this recent. */
  activityWindowMs: 60_000,
  /** Yield while the event loop's worst delay over the last few seconds is above this. */
  lagThresholdMs: 100,
  /** After this long of continuous live play the gate starts opening in slices. */
  starvationAfterMs: 10 * 60_000,
  /** Starvation slice: open this long ... */
  sliceOnMs: 5_000,
  /** ... out of every this long (about 8% duty). */
  slicePeriodMs: 60_000,
  /** A held decision re-checks this often. */
  pollMs: 1_000,
  /** Observations further apart than this do not count as one continuous stretch of live play. */
  staleObservationMs: 30_000,
} as const;

/** Off only when exactly "false"; anything else (including unset) leaves yielding on. */
export function isReviewYieldEnabled(): boolean {
  return process.env.REVIEW_YIELD_TO_LIVE_PLAY_ENABLED !== 'false';
}

export type ReviewYieldReason = 'idle' | 'disabled' | 'live_rooms' | 'event_loop_lag' | 'starvation_slice';

export type ReviewYieldDecision = {
  readonly allowed: boolean;
  readonly reason: ReviewYieldReason;
  readonly liveRooms: number;
  readonly lagMs: number;
};

let config: { -readonly [K in keyof typeof REVIEW_YIELD_CONFIG]: number } = { ...REVIEW_YIELD_CONFIG };

/** Counts the rooms that are live right now. Installed at boot; until then (and if it throws) there is no live play. */
type LiveRoomProbe = (now: number) => number;
let liveRoomProbe: LiveRoomProbe = () => 0;

export function setReviewLiveRoomProbe(probe: LiveRoomProbe): void {
  liveRoomProbe = probe;
}

// ---------------------------------------------------------------------------
// Event-loop lag: the worst timer drift over the last few seconds
// ---------------------------------------------------------------------------

const LAG_SAMPLE_MS = 250;
const LAG_WINDOW_SAMPLES = 20; // 5 s
const lagSamples: number[] = [];
let lagTimer: ReturnType<typeof setInterval> | null = null;
let lagSourceOverride: (() => number) | null = null;

function currentLagMs(): number {
  if (lagSourceOverride) return lagSourceOverride();
  return lagSamples.length > 0 ? Math.max(...lagSamples) : 0;
}

/** Start the drift sampler (idempotent). Returns a stop function. */
export function startReviewLagSampler(): () => void {
  if (lagTimer) return stopReviewLagSampler;
  let last = performance.now();
  lagTimer = setInterval(() => {
    const now = performance.now();
    lagSamples.push(Math.max(0, now - last - LAG_SAMPLE_MS));
    if (lagSamples.length > LAG_WINDOW_SAMPLES) lagSamples.shift();
    last = now;
  }, LAG_SAMPLE_MS);
  lagTimer.unref?.();
  return stopReviewLagSampler;
}

export function stopReviewLagSampler(): void {
  if (lagTimer) clearInterval(lagTimer);
  lagTimer = null;
  lagSamples.length = 0;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

type YieldState = {
  continuousLiveSince: number | null;
  lastObservedAt: number | null;
  lastDecision: ReviewYieldDecision | null;
  heldSince: number | null;
  claimsDeferred: number;
  decisionsHeld: number;
  heldMsTotal: number;
  starvationSlices: number;
  lastSliceIndex: number | null;
};

function freshState(): YieldState {
  return {
    continuousLiveSince: null,
    lastObservedAt: null,
    lastDecision: null,
    heldSince: null,
    claimsDeferred: 0,
    decisionsHeld: 0,
    heldMsTotal: 0,
    starvationSlices: 0,
    lastSliceIndex: null,
  };
}

let state = freshState();

/** May review work run right now? Each call is also an observation, which the starvation guard measures continuity from. */
export function reviewYieldDecision(now: number = Date.now()): ReviewYieldDecision {
  if (!isReviewYieldEnabled()) {
    return (state.lastDecision = { allowed: true, reason: 'disabled', liveRooms: 0, lagMs: 0 });
  }
  let liveRooms = 0;
  try {
    liveRooms = liveRoomProbe(now);
  } catch (error) {
    log.warn({ err: error }, 'live room probe failed; treating as no live play');
  }
  const lagMs = currentLagMs();
  const live = liveRooms > 0 || lagMs > config.lagThresholdMs;

  if (state.lastObservedAt != null && now - state.lastObservedAt > config.staleObservationMs) state.continuousLiveSince = null;
  state.lastObservedAt = now;

  if (!live) {
    state.continuousLiveSince = null;
    state.lastSliceIndex = null;
    return (state.lastDecision = { allowed: true, reason: 'idle', liveRooms, lagMs });
  }
  state.continuousLiveSince ??= now;
  const reason: ReviewYieldReason = liveRooms > 0 ? 'live_rooms' : 'event_loop_lag';
  const starvingFor = now - state.continuousLiveSince - config.starvationAfterMs;
  if (starvingFor >= 0 && starvingFor % config.slicePeriodMs < config.sliceOnMs) {
    const slice = Math.floor(starvingFor / config.slicePeriodMs);
    if (slice !== state.lastSliceIndex) {
      state.lastSliceIndex = slice;
      state.starvationSlices += 1;
    }
    return (state.lastDecision = { allowed: true, reason: 'starvation_slice', liveRooms, lagMs });
  }
  return (state.lastDecision = { allowed: false, reason, liveRooms, lagMs });
}

/** The sweep calls this before it claims anything: a deferred claim touches no job, so it burns no attempt. */
export function shouldDeferClaims(now: number = Date.now()): boolean {
  const decision = reviewYieldDecision(now);
  if (!decision.allowed) state.claimsDeferred += 1;
  return !decision.allowed;
}

type WaitOptions = {
  /** Stop holding (and let the caller carry on) when this returns true: shutdown, or a lost lease. */
  readonly shouldStop?: () => boolean;
};

let sleepImpl: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  timer.unref?.();
});

/** Resolves when review work may run. A held decision keeps its claim; nothing is released or counted. */
export async function waitForReviewSlot(options: WaitOptions = {}): Promise<void> {
  let heldAt: number | null = null;
  for (;;) {
    const decision = reviewYieldDecision();
    if (decision.allowed || options.shouldStop?.()) break;
    if (heldAt == null) {
      heldAt = Date.now();
      state.heldSince ??= heldAt;
      state.decisionsHeld += 1;
      log.info({ reason: decision.reason, liveRooms: decision.liveRooms, lagMs: Math.round(decision.lagMs) }, 'review decision held for live play');
    }
    await sleepImpl(config.pollMs);
  }
  if (heldAt != null) {
    state.heldMsTotal += Date.now() - heldAt;
    state.heldSince = null;
  }
}

function safeLiveRoomCount(now: number): number {
  try {
    return liveRoomProbe(now);
  } catch {
    return 0;
  }
}

/** What /health shows: whether review is paused right now and the counters behind it. */
export function getReviewYieldStatus(now: number = Date.now()) {
  const last = state.lastDecision;
  return {
    enabled: isReviewYieldEnabled(),
    pausedForLivePlay: last != null && !last.allowed && state.lastObservedAt != null && now - state.lastObservedAt <= config.staleObservationMs,
    reason: last?.reason ?? null,
    liveRooms: last?.liveRooms ?? 0,
    /** Counted fresh for this request (does not touch the gate), so /health shows what the next claim would see. */
    liveRoomsNow: safeLiveRoomCount(now),
    lagMs: last ? Math.round(last.lagMs) : 0,
    continuousLiveMs: state.continuousLiveSince != null ? Math.max(0, now - state.continuousLiveSince) : 0,
    claimsDeferred: state.claimsDeferred,
    decisionsHeld: state.decisionsHeld,
    heldMsTotal: Math.round(state.heldMsTotal),
    starvationSlices: state.starvationSlices,
    config: { ...config },
  };
}

// ---------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------

export function resetReviewYieldForTests(): void {
  state = freshState();
  config = { ...REVIEW_YIELD_CONFIG };
  liveRoomProbe = () => 0;
  lagSourceOverride = null;
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  stopReviewLagSampler();
}

export function configureReviewYieldForTests(overrides: Partial<typeof config>): void {
  config = { ...config, ...overrides };
}

export function setReviewLagSourceForTests(source: (() => number) | null): void {
  lagSourceOverride = source;
}

export function setReviewYieldSleepForTests(sleep: (ms: number) => Promise<void>): void {
  sleepImpl = sleep;
}

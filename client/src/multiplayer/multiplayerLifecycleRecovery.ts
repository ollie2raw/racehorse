/**
 * Background tab / page lifecycle resync policy (Phase W).
 * Does not replace RecoveryMachine — only requests RESYNC_NEEDED when state may be stale.
 */

export const LIFECYCLE_HIDDEN_RESYNC_MS = 45_000;
export const LIFECYCLE_RESYNC_COOLDOWN_MS = 30_000;

export type LifecycleResumeInput = {
  now: number;
  hiddenSinceMs: number | null;
  roomCode: string | null;
  matchStarted: boolean;
  recoveryState: 'idle' | 'connecting' | 'joining' | 'resyncing' | 'failed';
  socketConnected: boolean;
  resyncInFlight: boolean;
  rejoinInFlight: boolean;
  intentionalDisconnect: boolean;
  lastLifecycleResyncAtMs: number;
};

export type LifecycleResumeDecision = {
  shouldResync: boolean;
  reason: string | null;
};

export function evaluateLifecycleResumeResync(
  input: LifecycleResumeInput,
): LifecycleResumeDecision {
  if (!input.roomCode || !input.matchStarted) {
    return { shouldResync: false, reason: null };
  }
  if (input.intentionalDisconnect) {
    return { shouldResync: false, reason: 'intentional_disconnect' };
  }
  if (!input.socketConnected) {
    return { shouldResync: false, reason: 'socket_not_connected' };
  }
  if (input.resyncInFlight || input.rejoinInFlight) {
    return { shouldResync: false, reason: 'resync_or_rejoin_in_flight' };
  }
  if (input.recoveryState !== 'idle') {
    return { shouldResync: false, reason: 'recovery_active' };
  }
  if (input.now - input.lastLifecycleResyncAtMs < LIFECYCLE_RESYNC_COOLDOWN_MS) {
    return { shouldResync: false, reason: 'cooldown' };
  }

  const hiddenDurationMs =
    input.hiddenSinceMs != null ? input.now - input.hiddenSinceMs : 0;
  if (hiddenDurationMs < LIFECYCLE_HIDDEN_RESYNC_MS) {
    return { shouldResync: false, reason: 'hidden_duration_short' };
  }

  return { shouldResync: true, reason: 'hidden_stale' };
}

/**
 * A gap between two liveness ticks this long means the page's JS did not run: the OS suspended the app/webview. In a Capacitor
 * WKWebView the "hidden" transition is NOT reliably delivered before suspension (observed on the iOS simulator: only
 * blur/focus/pageshow/visibilitychange(visible) arrive, at resume), so suspension must be measured by the heartbeat, not only by
 * a hidden event.
 */
export const LIFECYCLE_SUSPEND_GAP_MS = 5_000;
export const LIFECYCLE_HEARTBEAT_MS = 1_000;

export function createLifecycleHiddenTracker(): {
  markHidden: (now: number) => void;
  /** Liveness tick: called from a short interval while the page's JS is running. */
  markAlive: (now: number) => void;
  /** When this resume began being "stale": the earliest of the hidden event and the last liveness tick before a suspension gap. */
  consumeHiddenSince: (now: number) => number | null;
  getHiddenSince: () => number | null;
  reset: () => void;
} {
  let hiddenSinceMs: number | null = null;
  let lastAliveMs: number | null = null;

  return {
    markHidden(now: number) {
      if (hiddenSinceMs === null) {
        hiddenSinceMs = now;
      }
    },
    markAlive(now: number) {
      lastAliveMs = now;
    },
    consumeHiddenSince(now: number) {
      const hidden = hiddenSinceMs;
      hiddenSinceMs = null;
      const alive = lastAliveMs;
      lastAliveMs = now; // resuming counts as alive
      const suspended = alive !== null && now - alive >= LIFECYCLE_SUSPEND_GAP_MS ? alive : null;
      if (hidden === null) return suspended;
      if (suspended === null) return hidden;
      return Math.min(hidden, suspended);
    },
    getHiddenSince() {
      return hiddenSinceMs;
    },
    reset() {
      hiddenSinceMs = null;
      lastAliveMs = null;
    },
  };
}
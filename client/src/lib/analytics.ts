/**
 * Product analytics.
 *
 * Deliberately instrumented at the API and bootstrap layer rather than in
 * React effects. This repo has shipped a fix for an effect that re-fired on an
 * object reference rather than an identity (#61), and StrictMode double-invokes
 * effects in development, so an effect-based `session_start` would over-count
 * by construction. Every call site here is either outside React entirely (the
 * bootstrap, the mode APIs) or a user-gesture callback.
 *
 * The client is loaded lazily so PostHog stays out of the entry bundle, and
 * every call is a no-op when no key is configured — which is the case in tests
 * and in any local build without the env var.
 */

export type AnalyticsMode =
  | 'daily_fritz'
  | 'daily_puzzle_ladder'
  | 'puzzle_rush'
  | 'multiplayer';

export type AnalyticsEvent =
  /** Once per page load. Retention is derived from this plus the person id. */
  | 'session_start'
  /** A run of any mode began. Distinguished by `mode`, not by event name. */
  | 'game_opened'
  /** A run of any mode finished. */
  | 'game_completed'
  /** The share action was tapped. Report §6.1's headline metric. */
  | 'share_initiated'
  // Tournaments (Phase 3E). Properties: kind, round, fritz_tier, error_code,
  // placement, outcome_kind — never names, user/tournament/bot ids or room state.
  | 'tournament_hub_viewed'
  | 'fritz_cup_tapped'
  | 'fritz_cup_created'
  | 'fritz_cup_create_failed'
  | 'live_event_register_tapped'
  | 'live_event_registered'
  | 'live_event_registration_failed'
  | 'tournament_match_ready'
  | 'tournament_match_joined'
  | 'tournament_eliminated'
  | 'tournament_champion';

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

/** What the module needs from PostHog. Narrow, so tests can stand in for it. */
export interface AnalyticsTransport {
  capture(event: AnalyticsEvent, props?: AnalyticsProps): void;
  identify(distinctId: string, props?: AnalyticsProps): void;
  reset(): void;
}

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com';

let transportPromise: Promise<AnalyticsTransport | null> | null = null;
/** Set by tests. Also the reason init is idempotent under StrictMode and HMR. */
let injected: AnalyticsTransport | null = null;

/**
 * Dev-only capture for end-to-end specs (VITE_E2E_ANALYTICS_CAPTURE=1, set only
 * by the Playwright tournament E2E dev server): events are kept on
 * `window.__rhAnalyticsEvents` so a journey can count them. Never in builds.
 */
function e2eCaptureTransport(): AnalyticsTransport | null {
  if (!import.meta.env.DEV || import.meta.env.VITE_E2E_ANALYTICS_CAPTURE !== '1' || typeof window === 'undefined') return null;
  const target = window as unknown as { __rhAnalyticsEvents?: Array<{ event: string; props?: AnalyticsProps }> };
  target.__rhAnalyticsEvents ??= [];
  return {
    capture: (event, props) => { target.__rhAnalyticsEvents!.push({ event, props }); },
    identify: () => undefined,
    reset: () => undefined,
  };
}

async function loadTransport(): Promise<AnalyticsTransport | null> {
  if (injected) return injected;
  const e2e = e2eCaptureTransport();
  if (e2e) return e2e;
  if (!KEY) return null;
  try {
    const { default: posthog } = await import('posthog-js');
    posthog.init(KEY, {
      api_host: HOST,
      // Retention has to include people who never sign up, so anonymous
      // visitors need person profiles too. The SDK default of
      // 'identified_only' would drop them and understate day-1 and day-7.
      person_profiles: 'always',
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: false,
    });
    return {
      capture: (event, props) => posthog.capture(event, props),
      identify: (distinctId, props) => posthog.identify(distinctId, props),
      reset: () => posthog.reset(),
    };
  } catch {
    // Analytics must never take the app down with it.
    return null;
  }
}

function transport(): Promise<AnalyticsTransport | null> {
  transportPromise ??= loadTransport();
  return transportPromise;
}

/** Records an event. Fire-and-forget: never awaited by product code. */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  // Best-effort: a failing client never throws into, or rejects under, the caller.
  try {
    void transport()
      .then((client) => client?.capture(event, props))
      .catch(() => undefined);
  } catch {
    // ignore
  }
}

/**
 * Links the anonymous person to a real account, so a visitor who plays for
 * days before signing up keeps one retention history rather than two.
 */
export function identifyUser(userId: string, props?: AnalyticsProps): void {
  void transport().then((client) => client?.identify(userId, props));
}

/** Unlinks on sign-out, so a shared device does not merge two people. */
export function resetAnalytics(): void {
  void transport().then((client) => client?.reset());
}

/** Test seam. Not for product code. */
export function __setAnalyticsTransport(next: AnalyticsTransport | null): void {
  injected = next;
  transportPromise = next ? Promise.resolve(next) : null;
}

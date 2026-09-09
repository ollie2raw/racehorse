/**
 * Volume guard for Sentry `beforeSend` (PRE_LAUNCH_HARDENING.md §3.1).
 *
 * A pure, SDK-agnostic mirror of `server/src/sentryVolumeGuard.ts` — kept as a
 * copy because client and server are separate packages with no shared util
 * module. Keep the two in sync.
 *
 * Errors are captured at 100% with no sampling. A single runaway error — a
 * component that throws on every render, a bad network condition that fires the
 * same exception on a loop — exhausts the free-tier event quota (5k/mo) in
 * minutes, and once the quota is gone *every subsequent real error is dropped*.
 * That is the worst failure mode: an error storm both floods and then blinds.
 *
 * This caps outbound events per rolling minute:
 *   - **per signature** (error type + a slice of the message): after
 *     `perSignatureMax`, only a heartbeat (1 in `sampleEvery`) gets through, so
 *     one loop can't crowd out everything else and can't burn the quota;
 *   - **global**: after `globalMax` *forwarded* events in the window, drop the
 *     rest, so a *diverse* storm is bounded too.
 *
 * Deliberately in-memory and lossy — one browser tab's counter, reset on
 * reload. The point is to survive a burst, not to be a ledger.
 */

export interface SentryVolumeGuardConfig {
  windowMs: number;
  /** Forwarded events per window before the global drop kicks in. */
  globalMax: number;
  /** Events for one signature per window before only heartbeats pass. */
  perSignatureMax: number;
  /** Past `perSignatureMax`, forward 1 in every `sampleEvery` as a "still happening" beacon. */
  sampleEvery: number;
}

export const DEFAULT_SENTRY_VOLUME_GUARD: SentryVolumeGuardConfig = {
  windowMs: 60_000,
  globalMax: 20,
  perSignatureMax: 5,
  sampleEvery: 20,
};

/** A minimal, SDK-agnostic view of what a Sentry error event carries. */
export interface VolumeGuardEvent {
  message?: string;
  exception?: { values?: Array<{ type?: string; value?: string }> };
  fingerprint?: string[];
}

export function sentryEventSignature(event: VolumeGuardEvent): string {
  if (event.fingerprint && event.fingerprint.length > 0) {
    return event.fingerprint.join('|').slice(0, 200);
  }
  const first = event.exception?.values?.[0];
  const type = first?.type ?? '';
  const value = (first?.value ?? event.message ?? '').slice(0, 120);
  if (!type && !value) return 'unknown';
  return `${type}:${value}`;
}

export interface SentryVolumeGuard {
  /** True → forward the event to Sentry; false → drop it. */
  shouldForward(event: VolumeGuardEvent, now?: number): boolean;
}

export function createSentryVolumeGuard(
  config: SentryVolumeGuardConfig = DEFAULT_SENTRY_VOLUME_GUARD,
): SentryVolumeGuard {
  let windowStart = 0;
  let forwardedThisWindow = 0;
  const seenThisWindow = new Map<string, number>();

  return {
    shouldForward(event, now = Date.now()) {
      if (now - windowStart >= config.windowMs) {
        windowStart = now;
        forwardedThisWindow = 0;
        seenThisWindow.clear();
      }

      const sig = sentryEventSignature(event);
      const seen = seenThisWindow.get(sig) ?? 0;
      seenThisWindow.set(sig, seen + 1);

      // One noisy signature: after the cap, only a periodic heartbeat.
      if (seen >= config.perSignatureMax) {
        return seen % config.sampleEvery === 0;
      }

      // Diverse storm: bound what we actually forward.
      if (forwardedThisWindow >= config.globalMax) {
        return false;
      }

      forwardedThisWindow += 1;
      return true;
    },
  };
}

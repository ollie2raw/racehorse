import { journeyNamespacedKeySuffix } from './journeyStorageScope';

/**
 * Local attempt log for Journey stages.
 *
 * Deliberately separate from `journeyStorage.ts` (stage unlock/completion state): that module's
 * sanitizer drops fields it does not know, and "what was attempted and how it ended" is a different
 * concern from "what is unlocked". Completion is still awarded only through `markJourneyNodeCompleted`
 * — this log records outcomes, it never grants progress by itself.
 *
 * STATES AND TRANSITIONS
 *
 *     in_progress ──► won | lost | abandoned        (terminal: never changes again)
 *
 *  Who may write a terminal state:
 *    - the OWNER (the page that started the attempt) — on a result, on leaving, or on `pagehide` when the
 *      page is being destroyed (not entering the back/forward cache);
 *    - anyone else only when the owner is provably gone: its last heartbeat is older than
 *      `JOURNEY_ATTEMPT_RECLAIM_AFTER_MS` (24 h).
 *
 *  "Stale" is NOT a persisted state. An `in_progress` attempt whose heartbeat is older than
 *  `JOURNEY_ATTEMPT_STALE_AFTER_MS` (3 min) is derived as `stale` by `getJourneyAttemptLiveness` — it may be
 *  a crashed tab or merely a frozen/throttled one, and from the outside the two cannot be told apart. So no
 *  other tab terminalizes it: it stays `in_progress`, a late result from its owner is still accepted, and it
 *  never blocks anything (starting an attempt never looks at other attempts). Readers may treat `stale` as
 *  "probably abandoned" without making that irreversible.
 *
 * STORAGE: ONE KEY PER ATTEMPT  (`rh_journey_attempts_v1:<namespace>:a:<attemptId>`)
 *
 *  `localStorage` has no compare-and-swap and no multi-key transaction. A single shared log would force every
 *  write to read-modify-write the whole thing, so two tabs writing different attempts at the same moment can
 *  erase one of them (lost update). With one key per attempt, different attempts can never overwrite each
 *  other, and in normal operation each key has exactly one writer — its owner, a single thread — so its
 *  writes are serialized.
 *
 *  What that does and does not buy:
 *    - Concurrent activity on DIFFERENT attempts cannot lose a record. (Each `setItem` is atomic per key.)
 *    - A delayed heartbeat cannot overwrite a terminal result: a beat is a conditional write — it re-reads
 *      the record immediately before writing and only writes if the record is still this page's
 *      `in_progress` attempt. The only other writer to that key is the 24 h reclaim, which by definition
 *      cannot coincide with a heartbeat that is fresh enough to be beating.
 *    - NOT guaranteed: two writers to the SAME key are not serialized. That requires the reclaim and the
 *      owner to act in the same instant on an attempt whose owner has been silent for 24 hours — outside any
 *      realistic play, but possible in principle.
 *    - NOT guaranteed: a tab frozen for more than 24 hours can have its attempt reclaimed as `abandoned` and
 *      then loses a late win. That is the one deliberate trade-off: a record that lingers `in_progress` for a
 *      day costs nothing (progress never reads attempts), whereas terminalizing a frozen tab's attempt on a
 *      short timer discards a player's result.
 *    - We do not listen to `storage` events; every page reads on demand.
 *
 * HEARTBEAT
 *  While a page has live attempts it refreshes their `heartbeatAt` every `JOURNEY_ATTEMPT_HEARTBEAT_MS`, and
 *  immediately when its tab becomes visible or is restored from the back/forward cache. Timers do not run in a
 *  frozen tab, which is exactly why a stale heartbeat alone is never treated as proof of death.
 *
 * LEGACY: Stage 1 briefly stored one JSON log at `rh_journey_attempts_v1:<namespace>`. That layout never
 * shipped; its key does not match the per-attempt prefix and is simply ignored.
 */

export const JOURNEY_ATTEMPTS_KEY = 'rh_journey_attempts_v1';

export const JOURNEY_ATTEMPT_KINDS = ['match', 'lesson', 'sprint'] as const;
export type JourneyAttemptKind = (typeof JOURNEY_ATTEMPT_KINDS)[number];

export const JOURNEY_ATTEMPT_STATES = ['in_progress', 'won', 'lost', 'abandoned'] as const;
export type JourneyAttemptState = (typeof JOURNEY_ATTEMPT_STATES)[number];
export type JourneyAttemptTerminalState = Exclude<JourneyAttemptState, 'in_progress'>;

export type JourneyAttemptDetail = Record<string, string | number | boolean | null>;

export interface JourneyAttempt {
  attemptId: string;
  nodeId: string;
  kind: JourneyAttemptKind;
  outcome: JourneyAttemptState;
  startedAt: string;
  /** null while `in_progress`. */
  endedAt: string | null;
  /** The page (load) that owns this attempt while it is in progress; null once finished. */
  ownerId: string | null;
  /** Epoch ms of the owner's last heartbeat; null once finished. */
  heartbeatAt: number | null;
  detail: JourneyAttemptDetail;
}

/** Oldest finished attempts are dropped beyond this; in-progress attempts are never dropped. */
export const JOURNEY_ATTEMPT_LOG_LIMIT = 500;
export const JOURNEY_ATTEMPT_HEARTBEAT_MS = 15_000;
/** Heartbeat age after which an attempt is DERIVED as `stale`. Never written; never terminalizes anything. */
export const JOURNEY_ATTEMPT_STALE_AFTER_MS = 3 * 60_000;
/** Heartbeat age after which anyone may mark an attempt `abandoned`: the owner is treated as gone. */
export const JOURNEY_ATTEMPT_RECLAIM_AFTER_MS = 24 * 60 * 60_000;

function createId(prefix: string): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return `${prefix}_${cryptoApi.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** Identifies this page load. Another tab — or this tab after a reload — has a different one. */
const pageOwnerId = createId('jpg');

/** Last `startedAt` this page issued (epoch ms), so one page never issues two equal start times. */
let lastStartedAtMs = 0;
function nextStartedAt(): string {
  lastStartedAtMs = Math.max(Date.now(), lastStartedAtMs + 1);
  return new Date(lastStartedAtMs).toISOString();
}

/**
 * Attempts this page started and has not finished, with the storage key each belongs to. The page's own
 * source of truth for "mine and alive"; the stored record is what other tabs read.
 */
const liveAttempts = new Map<string, { attempt: JourneyAttempt; key: string }>();

export function getJourneyAttemptKeyPrefix(): string {
  return `${JOURNEY_ATTEMPTS_KEY}${journeyNamespacedKeySuffix()}:a:`;
}

export function getJourneyAttemptStorageKey(attemptId: string): string {
  return `${getJourneyAttemptKeyPrefix()}${attemptId}`;
}

function isKind(value: unknown): value is JourneyAttemptKind {
  return typeof value === 'string' && (JOURNEY_ATTEMPT_KINDS as readonly string[]).includes(value);
}

function isState(value: unknown): value is JourneyAttemptState {
  return typeof value === 'string' && (JOURNEY_ATTEMPT_STATES as readonly string[]).includes(value);
}

function sanitizeDetail(value: unknown): JourneyAttemptDetail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: JourneyAttemptDetail = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null || typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      out[key] = entry;
    }
  }
  return out;
}

function sanitizeAttempt(value: unknown): JourneyAttempt | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.attemptId !== 'string' || raw.attemptId.length === 0) return null;
  if (typeof raw.nodeId !== 'string' || raw.nodeId.length === 0) return null;
  if (!isKind(raw.kind) || !isState(raw.outcome)) return null;
  if (typeof raw.startedAt !== 'string' || raw.startedAt.length === 0) return null;
  const endedAt = typeof raw.endedAt === 'string' && raw.endedAt.length > 0 ? raw.endedAt : null;
  const inProgress = raw.outcome === 'in_progress';
  return {
    attemptId: raw.attemptId,
    nodeId: raw.nodeId,
    kind: raw.kind,
    outcome: raw.outcome,
    startedAt: raw.startedAt,
    // The lifecycle invariant: only in-progress attempts lack an end time, and only they have an owner.
    endedAt: inProgress ? null : endedAt ?? raw.startedAt,
    ownerId: inProgress && typeof raw.ownerId === 'string' && raw.ownerId.length > 0 ? raw.ownerId : null,
    heartbeatAt: inProgress && typeof raw.heartbeatAt === 'number' && Number.isFinite(raw.heartbeatAt) ? raw.heartbeatAt : null,
    detail: sanitizeDetail(raw.detail),
  };
}

function readAttempt(key: string): JourneyAttempt | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? sanitizeAttempt(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeAttempt(key: string, attempt: JourneyAttempt): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(attempt));
  } catch {
    // Storage can be full or blocked (private mode); the log is best-effort and must never break a match.
  }
}

/** Storage keys of every attempt in the current namespace. Collected first: removing while iterating is unsafe. */
function attemptKeys(): string[] {
  if (typeof window === 'undefined') return [];
  const prefix = getJourneyAttemptKeyPrefix();
  const keys: string[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
}

function byStart(a: JourneyAttempt, b: JourneyAttempt): number {
  return a.startedAt === b.startedAt ? a.attemptId.localeCompare(b.attemptId) : a.startedAt.localeCompare(b.startedAt);
}

/** True when this page started the attempt and still considers it live. */
export function isJourneyAttemptOwnedByThisPage(attempt: JourneyAttempt): boolean {
  return attempt.ownerId === pageOwnerId && liveAttempts.has(attempt.attemptId);
}

export type JourneyAttemptLiveness = 'finished' | 'live' | 'active' | 'stale';

/**
 * Derived, never stored. `live`: this page owns it. `active`: another page's heartbeat is recent.
 * `stale`: no recent heartbeat — a crashed tab or a frozen/throttled one; indistinguishable from outside,
 * so it stays `in_progress` and can still receive its owner's late result.
 */
export function getJourneyAttemptLiveness(attempt: JourneyAttempt, at: number = Date.now()): JourneyAttemptLiveness {
  if (attempt.outcome !== 'in_progress') return 'finished';
  if (isJourneyAttemptOwnedByThisPage(attempt)) return 'live';
  return attempt.heartbeatAt != null && at - attempt.heartbeatAt <= JOURNEY_ATTEMPT_STALE_AFTER_MS ? 'active' : 'stale';
}

/** The owner is treated as gone: no heartbeat for the reclaim horizon (or never one). Not this page's own. */
function isReclaimable(attempt: JourneyAttempt, at: number): boolean {
  if (attempt.outcome !== 'in_progress' || isJourneyAttemptOwnedByThisPage(attempt)) return false;
  return attempt.heartbeatAt == null || at - attempt.heartbeatAt > JOURNEY_ATTEMPT_RECLAIM_AFTER_MS;
}

function abandoned(attempt: JourneyAttempt, endedAt: string): JourneyAttempt {
  return { ...attempt, outcome: 'abandoned', endedAt, ownerId: null, heartbeatAt: null };
}

/**
 * All attempts for the current namespace, oldest first. Reading terminalizes only attempts whose owner has
 * been silent for the reclaim horizon (24 h); a stale or active attempt of another page is returned as it is.
 */
export function loadJourneyAttempts(): JourneyAttempt[] {
  const at = Date.now();
  const endedAt = new Date(at).toISOString();
  const attempts: JourneyAttempt[] = [];
  for (const key of attemptKeys()) {
    const stored = readAttempt(key);
    if (!stored) continue;
    if (!isReclaimable(stored, at)) {
      attempts.push(stored);
      continue;
    }
    // Re-read right before the write: if the owner has settled or beaten in the meantime, leave it alone.
    const fresh = readAttempt(key);
    if (fresh && isReclaimable(fresh, at)) {
      const reclaimed = abandoned(fresh, endedAt);
      writeAttempt(key, reclaimed);
      attempts.push(reclaimed);
    } else if (fresh) {
      attempts.push(fresh);
    }
  }
  return attempts.sort(byStart);
}

/** Drops the oldest FINISHED attempts beyond the limit. In-progress attempts are never removed. */
function enforceLimit(): void {
  const keys = attemptKeys();
  if (keys.length <= JOURNEY_ATTEMPT_LOG_LIMIT) return;
  const finished = keys
    .map((key) => ({ key, attempt: readAttempt(key) }))
    .filter((entry): entry is { key: string; attempt: JourneyAttempt } => entry.attempt != null && entry.attempt.outcome !== 'in_progress')
    .sort((a, b) => byStart(a.attempt, b.attempt));
  let excess = keys.length - JOURNEY_ATTEMPT_LOG_LIMIT;
  for (const { key } of finished) {
    if (excess <= 0) break;
    try {
      window.localStorage.removeItem(key);
    } catch {
      return;
    }
    excess -= 1;
  }
}

// ── heartbeat ────────────────────────────────────────────────────────────────────────────────────

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let listenersInstalled = false;

function ownLiveAttemptsForCurrentNamespace() {
  const prefix = getJourneyAttemptKeyPrefix();
  return [...liveAttempts.values()].filter((entry) => entry.key.startsWith(prefix));
}

/**
 * Confirms this page's live attempts. Each beat is a CONDITIONAL write: it re-reads the record and writes
 * only if it is still this page's `in_progress` attempt — so a delayed heartbeat (a page waking from a
 * freeze) can never overwrite a terminal result, and never a newer owner. A record that has gone missing
 * (cleared storage) is restored from memory; one that finished elsewhere is forgotten.
 */
function beat(): void {
  const at = Date.now();
  for (const entry of ownLiveAttemptsForCurrentNamespace()) {
    const stored = readAttempt(entry.key);
    if (!stored) {
      writeAttempt(entry.key, { ...entry.attempt, ownerId: pageOwnerId, heartbeatAt: at });
    } else if (stored.outcome === 'in_progress' && stored.ownerId === pageOwnerId) {
      writeAttempt(entry.key, { ...stored, heartbeatAt: at });
    } else {
      liveAttempts.delete(entry.attempt.attemptId); // finished or taken over elsewhere: not ours to write
    }
  }
  stopHeartbeatIfIdle();
}

/**
 * `pagehide` with `persisted === false`: this page is being destroyed (reload, close, navigate away) and
 * cannot finish its attempts, so the OWNER records them as abandoned — authoritative, and not a guess
 * another tab has to make. When `persisted` is true the page is entering the back/forward cache and may be
 * restored alive, so nothing is written: it simply goes stale until `pageshow` beats again.
 */
function onPageHide(event: Event): void {
  if ((event as PageTransitionEvent).persisted === true) return;
  const endedAt = new Date().toISOString();
  for (const entry of ownLiveAttemptsForCurrentNamespace()) {
    const stored = readAttempt(entry.key);
    if (stored && stored.outcome === 'in_progress' && stored.ownerId === pageOwnerId) {
      writeAttempt(entry.key, abandoned(stored, endedAt));
    }
    liveAttempts.delete(entry.attempt.attemptId);
  }
  stopHeartbeatIfIdle();
}

function stopHeartbeatIfIdle(): void {
  if (liveAttempts.size > 0 || heartbeatTimer == null) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function ensureHeartbeat(): void {
  if (typeof window === 'undefined') return;
  if (heartbeatTimer == null) heartbeatTimer = setInterval(beat, JOURNEY_ATTEMPT_HEARTBEAT_MS);
  if (listenersInstalled) return;
  listenersInstalled = true;
  window.addEventListener('pagehide', onPageHide);
  // Restored from the back/forward cache: confirm we are alive again.
  window.addEventListener('pageshow', (event) => {
    if ((event as PageTransitionEvent).persisted) beat();
  });
  // A hidden tab's timers are throttled; confirm immediately when it is visible again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') beat();
  });
}

// ── public API ───────────────────────────────────────────────────────────────────────────────────

export function startJourneyAttempt(input: {
  nodeId: string;
  kind: JourneyAttemptKind;
  detail?: JourneyAttemptDetail;
}): JourneyAttempt {
  const attempt: JourneyAttempt = {
    attemptId: createId('jat'),
    nodeId: input.nodeId,
    kind: input.kind,
    outcome: 'in_progress',
    startedAt: nextStartedAt(),
    endedAt: null,
    ownerId: pageOwnerId,
    heartbeatAt: Date.now(),
    detail: sanitizeDetail(input.detail),
  };
  const key = getJourneyAttemptStorageKey(attempt.attemptId);
  liveAttempts.set(attempt.attemptId, { attempt, key });
  // A start writes only its own record: it neither reads nor touches any other attempt, stale or not.
  writeAttempt(key, attempt);
  enforceLimit();
  ensureHeartbeat();
  return attempt;
}

/**
 * An attempt by id: from storage, or — if its record has gone missing — this page's own in-memory copy of an
 * attempt it started in the current namespace.
 */
export function findJourneyAttempt(attemptId: string): JourneyAttempt | null {
  const key = getJourneyAttemptStorageKey(attemptId);
  const stored = readAttempt(key);
  if (stored) return stored;
  const live = liveAttempts.get(attemptId);
  return live && live.key === key ? live.attempt : null;
}

export type JourneyAttemptSettlementRefusal = 'unknown_attempt' | 'already_terminal' | 'owned_elsewhere';

export interface JourneyAttemptSettlement {
  /** The attempt after the call, or null when `attemptId` is unknown to the current namespace. */
  attempt: JourneyAttempt | null;
  /** True only for the one call that moved the attempt out of `in_progress`. */
  changed: boolean;
  /** Why nothing changed. Callers must not treat a refused WIN as recorded — see `recordJourneyMatchOutcome`. */
  reason?: JourneyAttemptSettlementRefusal;
}

/**
 * Moves an in-progress attempt to a terminal state. Idempotent by construction: a terminal attempt is
 * never rewritten, so a duplicate game-over callback (or a late "abandon" after a recorded win/loss)
 * returns `changed: false` and cannot flip or duplicate the outcome.
 *
 * Only the page that owns a live attempt may settle it. A stale attempt (silent heartbeat, but not past the
 * reclaim horizon) is still `in_progress` and still accepts its owner's late result. Another tab's attempt is
 * refused (`owned_elsewhere`) rather than touched; an attempt already terminal — notably one reclaimed after
 * 24 h of silence — is refused as `already_terminal`, reported to the caller, never written over.
 */
export function settleJourneyAttempt(
  attemptId: string,
  outcome: JourneyAttemptTerminalState,
  detail?: JourneyAttemptDetail,
): JourneyAttemptSettlement {
  const key = getJourneyAttemptStorageKey(attemptId);
  const stored = readAttempt(key);
  const endedAt = new Date().toISOString();
  const merge = (base: JourneyAttemptDetail) => (detail ? { ...base, ...sanitizeDetail(detail) } : base);

  if (!stored) {
    // The record is gone. If it is ours (storage cleared, or an external removal) restore it, settled, so a
    // legitimate result is not lost with it.
    const live = liveAttempts.get(attemptId);
    if (live && live.key === key) {
      const restored: JourneyAttempt = { ...live.attempt, outcome, endedAt, ownerId: null, heartbeatAt: null, detail: merge(live.attempt.detail) };
      liveAttempts.delete(attemptId);
      writeAttempt(key, restored);
      stopHeartbeatIfIdle();
      return { attempt: restored, changed: true };
    }
    return { attempt: null, changed: false, reason: 'unknown_attempt' };
  }

  if (stored.outcome !== 'in_progress') {
    liveAttempts.delete(attemptId);
    stopHeartbeatIfIdle();
    return { attempt: stored, changed: false, reason: 'already_terminal' };
  }
  if (!isJourneyAttemptOwnedByThisPage(stored)) {
    return { attempt: stored, changed: false, reason: 'owned_elsewhere' };
  }

  const settled: JourneyAttempt = { ...stored, outcome, endedAt, ownerId: null, heartbeatAt: null, detail: merge(stored.detail) };
  liveAttempts.delete(attemptId);
  writeAttempt(key, settled);
  stopHeartbeatIfIdle();
  return { attempt: settled, changed: true };
}

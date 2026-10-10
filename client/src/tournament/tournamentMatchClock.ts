/**
 * The tournament turn clock as the server last reported it, for the room the
 * player is in (Phase 3D). Fed by `state:update`, the attach ack and
 * `tournament:clock` (scheduled-tournament rooms only). Display only: the
 * server's timer decides; nothing here acts when a countdown reaches zero.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { estimatedServerNowMs, observeTournamentPush } from './tournamentClock';

export type TournamentClockState =
  | {
      kind: 'turn';
      /** The human seat whose turn it is. */
      seatId: string;
      deadlineAt: string;
      /** That seat's consecutive missed turns so far. */
      missedTurns: number;
      /** The missed turn that forfeits the match. */
      maxMissedTurns: number;
    }
  | {
      kind: 'next_hand';
      seatId: null;
      waitingSeatIds: string[];
      deadlineAt: string;
    };

export type TournamentClockSnapshot = {
  roomCode: string;
  clock: TournamentClockState | null;
  /** Estimated server time when this deadline was first seen (sizes the progress bar). */
  firstSeenServerMs: number | null;
};

let snapshot: TournamentClockSnapshot | null = null;
const listeners = new Set<() => void>();

const normalize = (code: string) => code.trim().toUpperCase();

function emit(): void {
  for (const listener of listeners) listener();
}

function isClockState(value: unknown): value is TournamentClockState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.deadlineAt !== 'string' || !Number.isFinite(Date.parse(v.deadlineAt))) return false;
  if (v.kind === 'turn') {
    return typeof v.seatId === 'string' && typeof v.missedTurns === 'number' && typeof v.maxMissedTurns === 'number';
  }
  return v.kind === 'next_hand' && Array.isArray(v.waitingSeatIds);
}

/**
 * Record what the server says the room's clock is. A payload without the
 * `tournamentClock` field (a non-tournament room) is ignored by callers; an
 * explicit null clears the clock.
 */
export function recordTournamentClock(roomCode: string | null | undefined, clock: unknown, serverNow?: unknown): void {
  if (!roomCode) return;
  if (typeof serverNow === 'string') observeTournamentPush(serverNow);
  const code = normalize(roomCode);
  const next = isClockState(clock) ? clock : null;
  const prev = snapshot?.roomCode === code ? snapshot : null;
  const sameDeadline = Boolean(prev?.clock && next && prev.clock.kind === next.kind && prev.clock.deadlineAt === next.deadlineAt);
  if (sameDeadline && prev && JSON.stringify(prev.clock) === JSON.stringify(next)) return;
  snapshot = {
    roomCode: code,
    clock: next,
    firstSeenServerMs: next ? (sameDeadline ? prev!.firstSeenServerMs : estimatedServerNowMs()) : null,
  };
  emit();
}

/**
 * From a `state:update`: only scheduled-tournament rooms send `tournamentClock`
 * (null included). Any other room's update leaves the clock untouched.
 */
export function recordTournamentClockFromStateUpdate(
  roomCode: string | null | undefined,
  payload: { tournamentClock?: unknown; serverNow?: unknown } | null | undefined,
): boolean {
  if (!payload || !('tournamentClock' in payload)) return false;
  recordTournamentClock(roomCode, payload.tournamentClock, payload.serverNow);
  return true;
}

/** Forget the clock (the player left the room, or the match is over). */
export function clearTournamentClock(roomCode?: string | null): void {
  if (!snapshot) return;
  if (roomCode && snapshot.roomCode !== normalize(roomCode)) return;
  snapshot = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => snapshot;

/** The clock for this room only; another room's clock is never shown. */
export function useTournamentMatchClock(roomCode: string | null | undefined): TournamentClockSnapshot | null {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!roomCode || !current || current.roomCode !== normalize(roomCode)) return null;
  return current;
}

/** How long past a deadline the HUD waits for the server's update before asking for state. */
export const TOURNAMENT_CLOCK_STALE_GRACE_MS = 5_000;

/**
 * The room's clock lifecycle: forget it when the player leaves or changes room,
 * and — if a deadline passes and no update arrives within the grace — ask the
 * existing state-recovery path once for that deadline. Never plays, passes or
 * forfeits: the server's timer resolves the turn.
 */
export function useTournamentClockRecovery(params: {
  roomCode: string | null | undefined;
  active: boolean;
  requestState: (reason: string) => void;
}): void {
  const { roomCode, active } = params;
  const requestRef = useRef(params.requestState);
  useEffect(() => {
    requestRef.current = params.requestState;
  });
  const current = useTournamentMatchClock(active ? roomCode : null);

  useEffect(() => {
    if (!roomCode) return;
    return () => clearTournamentClock(roomCode);
  }, [roomCode]);

  const clock = current?.clock ?? null;
  const deadlineAt = clock?.deadlineAt ?? null;
  useEffect(() => {
    if (!active || !current || !deadlineAt) return;
    const watched = current;
    const delay = Math.max(0, Date.parse(deadlineAt) - estimatedServerNowMs()) + TOURNAMENT_CLOCK_STALE_GRACE_MS;
    const timer = setTimeout(() => {
      if (snapshot === watched) requestRef.current('tournament_clock_stale');
    }, delay);
    return () => clearTimeout(timer);
  }, [active, current, deadlineAt]);
}

export function resetTournamentMatchClockForTests(): void {
  snapshot = null;
  emit();
}

// ── view ──────────────────────────────────────────────────────────────────

export type TournamentClockView =
  | { kind: 'none' }
  | {
      kind: 'turn';
      mine: boolean;
      remainingMs: number;
      /** 0..1 of the time left since this deadline was first seen. */
      fraction: number;
      /** Reached zero: the server is resolving the turn (nothing is done locally). */
      resolving: boolean;
      /** The local player's own consecutive misses (never the opponent's). */
      missedTurns: number;
      maxMissedTurns: number;
    }
  | { kind: 'next_hand'; remainingMs: number; fraction: number; resolving: boolean };

export function deriveTournamentClockView(input: {
  snapshot: TournamentClockSnapshot | null;
  you: string;
  nowServerMs: number;
  gameOver: boolean;
}): TournamentClockView {
  const clock = input.snapshot?.clock ?? null;
  if (!clock || input.gameOver) return { kind: 'none' };
  const deadlineMs = Date.parse(clock.deadlineAt);
  const remainingMs = Math.max(0, deadlineMs - input.nowServerMs);
  const span = input.snapshot?.firstSeenServerMs != null ? deadlineMs - input.snapshot.firstSeenServerMs : 0;
  const fraction = span > 0 ? Math.max(0, Math.min(1, remainingMs / span)) : remainingMs > 0 ? 1 : 0;
  const resolving = remainingMs <= 0;
  if (clock.kind === 'next_hand') return { kind: 'next_hand', remainingMs, fraction, resolving };
  const mine = clock.seatId === input.you;
  return {
    kind: 'turn',
    mine,
    remainingMs,
    fraction,
    resolving,
    missedTurns: mine ? clock.missedTurns : 0,
    maxMissedTurns: clock.maxMissedTurns,
  };
}

/** Whole seconds left, rounded up (shows 1s until the deadline, never 0s early). */
export function clockSeconds(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

export function tournamentClockLabel(view: TournamentClockView): string | null {
  if (view.kind === 'none') return null;
  if (view.kind === 'next_hand') {
    return view.resolving ? 'Starting next hand…' : `Next hand in ${clockSeconds(view.remainingMs)}s`;
  }
  if (view.resolving) return 'Resolving turn…';
  return `${view.mine ? 'Your turn' : "Opponent's turn"} · ${clockSeconds(view.remainingMs)}s`;
}

/** The local player's missed-turn warning, from the server's counts (never a hard-coded limit). */
export function missedTurnWarning(view: TournamentClockView): { text: string; severe: boolean } | null {
  if (view.kind !== 'turn' || !view.mine || view.missedTurns <= 0) return null;
  const n = view.missedTurns;
  const count = `${n} missed turn${n === 1 ? '' : 's'}`;
  const left = view.maxMissedTurns - n;
  if (left === 1 && n > 1) return { text: `${count} · one more will forfeit the match`, severe: true };
  if (left === 1) return { text: `${count} · another will forfeit the match`, severe: true };
  return { text: count, severe: false };
}

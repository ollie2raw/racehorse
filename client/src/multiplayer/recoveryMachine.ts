/**
 * Client room recovery state machine (item 6).
 * Single scheduler, max 5 attempts per episode, explicit policy/target invariants.
 *
 * Recovery authority contract (Phase K):
 * Recovery state is driven only by:
 * - recoveryMachine snapshot
 * - episodeSequence gate (socketEventBus)
 * - socketEventBus projection gate
 * Any other derived state is invalid for recovery authority.
 */

import { recordRecoveryTransition } from './mpTelemetry';
import { clearAllIngressState } from './socketEventBus';
import { RECOVERY_AUTHORITY_CONTRACT } from './recoveryAuthorityContract';

export const MAX_RECOVERY_ATTEMPTS = 5;

export type RecoveryState = 'idle' | 'connecting' | 'joining' | 'resyncing' | 'failed';
export type RecoveryPolicy = 'auto' | 'manual_only' | 'disabled';

/** Legacy UI mapping used by LiveMatchScreen / lobby banners. */
export type LegacyRoomRecoveryState = 'idle' | 'reconnecting' | 'resyncing' | 'failed';

export type RecoveryMachineSnapshot = {
  state: RecoveryState;
  policy: RecoveryPolicy;
  targetRoom: string | null;
  /** Coalesced indirect resync request while machine is non-idle (Phase B). */
  pendingResyncRoomCode: string | null;
  attempt: number;
  episodeId: number;
  manualRetry: boolean;
  lastMessage: string;
  /** Set when an episode closes; blocks post-success pending flush (Phase J). */
  lastEpisodeClosedAt?: number;
  /** Internal reducer re-entry guard (Phase I). */
  _transitionLock?: boolean;
};

let recoveryReducerInFlight = false;

export function resetRecoveryConcurrencyStateForTests(): void {
  recoveryReducerInFlight = false;
}

export type RecoveryEvent =
  | { type: 'SOCKET_LOST'; roomCode: string }
  | { type: 'SOCKET_CONNECTED' }
  | { type: 'TRANSPORT_FAIL'; reason?: string; episodeSequence?: number }
  | { type: 'ROOM_JOIN_OK'; episodeSequence?: number }
  | { type: 'ROOM_JOIN_TRANSIENT'; error?: string }
  | { type: 'ROOM_JOIN_TERMINAL'; error: string; episodeSequence?: number }
  | { type: 'RESYNC_NEEDED'; roomCode: string; episodeSequence?: number }
  | { type: 'RESYNC_OK' }
  | { type: 'RESYNC_FAIL'; terminal?: boolean; reason?: string }
  | { type: 'MANUAL_JOIN'; roomCode: string }
  | { type: 'USER_RETRY' }
  | { type: 'USER_LEAVE' }
  | { type: 'USER_DISMISS' }
  | { type: 'SESSION_SUPERSEDED'; roomCode: string }
  | { type: 'SET_POLICY'; policy: RecoveryPolicy }
  | { type: 'SET_TARGET_ROOM'; roomCode: string | null }
  | { type: 'SCHEDULED_RETRY' };

export type RecoveryEffect =
  | { type: 'cancel_schedule' }
  | { type: 'schedule'; delayMs: number; episodeId: number }
  | { type: 'connect' }
  | { type: 'room_join'; roomCode: string }
  | { type: 'resync'; roomCode: string }
  | { type: 'clear_terminal_room'; roomCode: string | null };

export type RecoveryTransition = {
  snapshot: RecoveryMachineSnapshot;
  effects: RecoveryEffect[];
};

export type RecoveryLogEntry = {
  from: RecoveryState;
  to: RecoveryState;
  event: RecoveryEvent['type'];
  attempt: number;
  episodeId: number;
  policy: RecoveryPolicy;
  targetRoom: string | null;
};

type Scheduler = {
  schedule: (delayMs: number, cb: () => void) => void;
  cancel: () => void;
};

export type CreateRecoveryMachineOptions = {
  scheduler?: Scheduler;
  onLog?: (entry: RecoveryLogEntry) => void;
  onEffect?: (effect: RecoveryEffect) => void;
  initialPolicy?: RecoveryPolicy;
};

const TERMINAL_JOIN_MARKERS = [
  'abandoned',
  'completed',
  'match_completed',
  'match_terminal',
  'snapshot_terminal',
  'forfeited',
  'expired',
  'not found',
] as const;

export function normalizeRecoveryRoomCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function isTerminalJoinError(error: string): boolean {
  const lower = error.toLowerCase();
  return TERMINAL_JOIN_MARKERS.some((marker) => lower.includes(marker));
}

export function recoveryBackoffMs(attempt: number): number {
  const clamped = Math.min(Math.max(attempt, 1), 8);
  return Math.min(10_000, 1500 + clamped * 750);
}

/** Invariant: joining/resyncing only when policy and manual retry allow it. */
export function canEnterJoinOrResync(snapshot: RecoveryMachineSnapshot): boolean {
  if (snapshot.policy === 'disabled' || !snapshot.targetRoom) return false;
  if (snapshot.policy === 'auto') return true;
  return snapshot.manualRetry;
}

export function deriveReconnectShouldJoin(snapshot: RecoveryMachineSnapshot): boolean {
  if (!snapshot.targetRoom || snapshot.policy === 'disabled') return false;
  if (snapshot.state === 'connecting' || snapshot.state === 'joining') return true;
  if (snapshot.state === 'failed' && snapshot.manualRetry) return true;
  return false;
}

/** Shim for legacy preventAutoRejoinRef — blocks auto room:join on connect. */
export function derivePreventAutoRejoin(snapshot: RecoveryMachineSnapshot): boolean {
  if (snapshot.policy === 'disabled') return true;
  if (snapshot.policy === 'manual_only' && !snapshot.manualRetry) return true;
  return false;
}

export function deriveReconnectRoomCode(snapshot: RecoveryMachineSnapshot): string | null {
  return snapshot.targetRoom;
}

export function deriveLegacyRoomRecoveryState(
  snapshot: RecoveryMachineSnapshot,
): LegacyRoomRecoveryState {
  switch (snapshot.state) {
    case 'connecting':
    case 'joining':
      return 'reconnecting';
    case 'resyncing':
      return 'resyncing';
    case 'failed':
      return 'failed';
    default:
      return 'idle';
  }
}

function initialSnapshot(policy: RecoveryPolicy = 'auto'): RecoveryMachineSnapshot {
  return {
    state: 'idle',
    policy,
    targetRoom: null,
    pendingResyncRoomCode: null,
    attempt: 0,
    episodeId: 0,
    manualRetry: false,
    lastMessage: '',
  };
}

function withMessage(snapshot: RecoveryMachineSnapshot, message: string): RecoveryMachineSnapshot {
  return { ...snapshot, lastMessage: message };
}

function nextEpisode(snapshot: RecoveryMachineSnapshot): RecoveryMachineSnapshot {
  return {
    ...snapshot,
    episodeId: snapshot.episodeId + 1,
    attempt: 1,
    manualRetry: false,
  };
}

function resetEpisode(snapshot: RecoveryMachineSnapshot): RecoveryMachineSnapshot {
  return {
    ...snapshot,
    attempt: 0,
    manualRetry: false,
    lastMessage: '',
  };
}

/** Single episode closure boundary — clears pending/attempt state and marks episode closed. */
export function closeRecoveryEpisode(
  snapshot: RecoveryMachineSnapshot,
): RecoveryMachineSnapshot {
  return {
    ...snapshot,
    pendingResyncRoomCode: null,
    attempt: 0,
    manualRetry: false,
    lastMessage: '',
    lastEpisodeClosedAt: snapshot.episodeId,
  };
}

function shouldClearIngressOnRecoveryEvent(
  event: RecoveryEvent,
  next: RecoveryMachineSnapshot,
): boolean {
  if (event.type === 'USER_LEAVE') {
    return true;
  }
  if (event.type === 'ROOM_JOIN_TERMINAL') {
    return true;
  }
  if (event.type === 'SET_POLICY' && event.policy === 'disabled') {
    return true;
  }
  if (event.type === 'SET_TARGET_ROOM' && event.roomCode === null && next.targetRoom === null) {
    return next.policy === 'disabled';
  }
  return false;
}

function isStaleEpisodeEvent(
  snapshot: RecoveryMachineSnapshot,
  episodeSequence: number | undefined,
): boolean {
  return episodeSequence !== undefined && episodeSequence < snapshot.episodeId;
}

/** True when an inbound event belongs to a prior recovery episode (Phase K). */
export function isEpisodeStaleRecoveryEvent(
  snapshot: RecoveryMachineSnapshot,
  event: RecoveryEvent,
): boolean {
  const episodeSequence =
    'episodeSequence' in event ? event.episodeSequence : undefined;
  if (episodeSequence === undefined) {
    return false;
  }
  return episodeSequence < snapshot.episodeId;
}

function assertRecoveryAuthorityContractInDev(): void {
  if (!import.meta.env?.DEV) return;
  if (RECOVERY_AUTHORITY_CONTRACT !== 'recoveryMachine+episodeSequence+projectionGate') {
    console.error('[recoveryMachine] recovery authority contract drift detected');
  }
}

function clearStalePendingResyncOnBoundary(
  snapshot: RecoveryMachineSnapshot,
  event: { episodeSequence?: number },
): RecoveryMachineSnapshot {
  if (!isStaleEpisodeEvent(snapshot, event.episodeSequence)) {
    return snapshot;
  }
  if (snapshot.pendingResyncRoomCode === null) {
    return snapshot;
  }
  return { ...snapshot, pendingResyncRoomCode: null };
}

function clearedTerminal(snapshot: RecoveryMachineSnapshot): RecoveryMachineSnapshot {
  return withMessage(
    closeRecoveryEpisode({
      ...snapshot,
      state: 'idle',
      policy: 'disabled',
      targetRoom: null,
    }),
    'Match is no longer available.',
  );
}

/** Flush a single coalesced resync after the machine reaches idle. */
function applyPendingResyncAfterIdle(
  idleSnapshot: RecoveryMachineSnapshot,
  baseEffects: RecoveryEffect[],
): RecoveryTransition {
  if (idleSnapshot.state !== 'idle') {
    return { snapshot: idleSnapshot, effects: baseEffects };
  }
  if (idleSnapshot.lastEpisodeClosedAt === idleSnapshot.episodeId) {
    return {
      snapshot: { ...idleSnapshot, pendingResyncRoomCode: null },
      effects: baseEffects,
    };
  }
  const pending = idleSnapshot.pendingResyncRoomCode;
  if (!pending) {
    return { snapshot: idleSnapshot, effects: baseEffects };
  }
  const withTarget = {
    ...idleSnapshot,
    targetRoom: pending,
    pendingResyncRoomCode: null,
  };
  if (!canEnterJoinOrResync(withTarget)) {
    return {
      snapshot: { ...idleSnapshot, pendingResyncRoomCode: null },
      effects: baseEffects,
    };
  }
  return {
    snapshot: withMessage({ ...withTarget, state: 'resyncing' }, 'Syncing game state…'),
    effects: [...baseEffects, { type: 'resync', roomCode: pending }],
  };
}


function failExhausted(
  snapshot: RecoveryMachineSnapshot,
  message: string,
): { snapshot: RecoveryMachineSnapshot; effects: RecoveryEffect[] } {
  return {
    snapshot: withMessage(
      {
        ...snapshot,
        state: 'failed',
        policy: snapshot.policy === 'disabled' ? 'disabled' : 'manual_only',
        manualRetry: false,
        lastMessage: message,
      },
      message,
    ),
    effects: [{ type: 'cancel_schedule' }],
  };
}

function bumpAttemptOrFail(
  snapshot: RecoveryMachineSnapshot,
  retryMessage: string,
  exhaustedMessage: string,
): { snapshot: RecoveryMachineSnapshot; effects: RecoveryEffect[] } {
  if (snapshot.attempt >= MAX_RECOVERY_ATTEMPTS) {
    return failExhausted(snapshot, exhaustedMessage);
  }
  const nextAttempt = snapshot.attempt + 1;
  const delayMs = recoveryBackoffMs(nextAttempt);
  return {
    snapshot: withMessage(
      {
        ...snapshot,
        state: 'connecting',
        attempt: nextAttempt,
        lastMessage: retryMessage,
      },
      retryMessage,
    ),
    effects: [
      { type: 'cancel_schedule' },
      { type: 'schedule', delayMs, episodeId: snapshot.episodeId },
    ],
  };
}

/**
 * Pure transition reducer. Scheduler effects are returned for the machine owner to execute.
 */
function clearTransitionLock(
  snapshot: RecoveryMachineSnapshot,
): RecoveryMachineSnapshot {
  if (!snapshot._transitionLock) {
    return snapshot;
  }
  return { ...snapshot, _transitionLock: false };
}

export function reduceRecovery(
  snapshot: RecoveryMachineSnapshot,
  event: RecoveryEvent,
): RecoveryTransition {
  if (snapshot._transitionLock === true || recoveryReducerInFlight) {
    return { snapshot: clearTransitionLock(snapshot), effects: [] };
  }

  recoveryReducerInFlight = true;
  try {
    const result = reduceRecoveryCore({ ...snapshot, _transitionLock: true }, event);
    return {
      snapshot: clearTransitionLock(result.snapshot),
      effects: result.effects,
    };
  } finally {
    recoveryReducerInFlight = false;
  }
}

function reduceRecoveryCore(
  snapshot: RecoveryMachineSnapshot,
  event: RecoveryEvent,
): RecoveryTransition {
  switch (event.type) {
    case 'SET_POLICY': {
      const next = { ...snapshot, policy: event.policy };
      if (
        event.policy === 'disabled' &&
        (next.state === 'connecting' || next.state === 'joining' || next.state === 'resyncing')
      ) {
        return {
          snapshot: closeRecoveryEpisode({ ...next, state: 'idle' }),
          effects: [{ type: 'cancel_schedule' }],
        };
      }
      if (
        event.policy === 'manual_only' &&
        next.state === 'connecting' &&
        !next.manualRetry
      ) {
        return {
          snapshot: resetEpisode({ ...next, state: 'idle', pendingResyncRoomCode: null }),
          effects: [{ type: 'cancel_schedule' }],
        };
      }
      return {
        snapshot: next,
        effects: [],
      };
    }

    case 'SET_TARGET_ROOM':
      return {
        snapshot: { ...snapshot, targetRoom: normalizeRecoveryRoomCode(event.roomCode) },
        effects: [],
      };

    case 'SOCKET_LOST': {
      const roomCode = normalizeRecoveryRoomCode(event.roomCode);
      if (!roomCode) {
        return { snapshot, effects: [] };
      }
      if (snapshot.policy === 'disabled') {
        return {
          snapshot: withMessage(snapshot, 'Connection lost.'),
          effects: [],
        };
      }
      if (snapshot.policy === 'manual_only') {
        return {
          snapshot: withMessage(
            { ...snapshot, targetRoom: roomCode },
            'Connection lost. Tap Retry when ready.',
          ),
          effects: [{ type: 'cancel_schedule' }],
        };
      }
      const next = withMessage(
        nextEpisode({ ...snapshot, state: 'connecting', targetRoom: roomCode, manualRetry: false }),
        'Connection lost. Reconnecting to room…',
      );
      return {
        snapshot: next,
        effects: [
          { type: 'cancel_schedule' },
          { type: 'schedule', delayMs: recoveryBackoffMs(1), episodeId: next.episodeId },
        ],
      };
    }

    case 'SOCKET_CONNECTED': {
      if (snapshot.state !== 'connecting') {
        return { snapshot, effects: [] };
      }
      if (!canEnterJoinOrResync(snapshot)) {
        return applyPendingResyncAfterIdle(
          resetEpisode({ ...snapshot, state: 'idle' }),
          [{ type: 'cancel_schedule' }],
        );
      }
      const roomCode = snapshot.targetRoom!;
      return {
        snapshot: withMessage(
          { ...snapshot, state: 'joining' },
          'Rejoining room…',
        ),
        effects: [
          { type: 'cancel_schedule' },
          { type: 'room_join', roomCode },
        ],
      };
    }

    case 'TRANSPORT_FAIL': {
      if (snapshot.state !== 'connecting' && snapshot.state !== 'joining') {
        return { snapshot, effects: [] };
      }
      const message =
        snapshot.state === 'joining'
          ? 'Room reconnect timed out. Retrying…'
          : 'Connection unstable. Retrying…';
      const exhausted = 'Reconnect failed after multiple attempts.';
      const result = bumpAttemptOrFail(snapshot, message, exhausted);
      return {
        ...result,
        snapshot: clearStalePendingResyncOnBoundary(result.snapshot, event),
      };
    }

    case 'ROOM_JOIN_OK': {
      if (snapshot.state !== 'joining' && snapshot.state !== 'connecting') {
        return { snapshot, effects: [] };
      }
      if (isStaleEpisodeEvent(snapshot, event.episodeSequence)) {
        return {
          snapshot: clearStalePendingResyncOnBoundary(
            resetEpisode({ ...snapshot, state: 'idle' }),
            event,
          ),
          effects: [{ type: 'cancel_schedule' }],
        };
      }
      return applyPendingResyncAfterIdle(
        resetEpisode({ ...snapshot, state: 'idle' }),
        [{ type: 'cancel_schedule' }],
      );
    }

    case 'ROOM_JOIN_TRANSIENT': {
      if (snapshot.state !== 'joining') {
        return { snapshot, effects: [] };
      }
      const message = 'Room reconnect rejected. Retrying…';
      const exhausted = 'Could not rejoin the room.';
      return bumpAttemptOrFail(snapshot, message, exhausted);
    }

    case 'ROOM_JOIN_TERMINAL': {
      if (snapshot.state !== 'joining' && snapshot.state !== 'connecting') {
        return { snapshot, effects: [] };
      }
      const roomCode = snapshot.targetRoom;
      const message = isTerminalJoinError(event.error)
        ? event.error.toLowerCase().includes('not found')
          ? 'Room no longer exists. Return to home.'
          : 'Match is no longer available.'
        : 'Match is no longer available.';
      const terminalSnapshot = withMessage(clearedTerminal(snapshot), message);
      return {
        snapshot: clearStalePendingResyncOnBoundary(terminalSnapshot, event),
        effects: [
          { type: 'cancel_schedule' },
          { type: 'clear_terminal_room', roomCode },
        ],
      };
    }

    case 'RESYNC_NEEDED': {
      const roomCode = normalizeRecoveryRoomCode(event.roomCode);
      if (!roomCode) {
        return { snapshot, effects: [] };
      }
      if (snapshot.state === 'resyncing') {
        return { snapshot, effects: [] };
      }
      if (snapshot.state !== 'idle') {
        return {
          snapshot: { ...snapshot, pendingResyncRoomCode: roomCode },
          effects: [],
        };
      }
      const withTarget = { ...snapshot, targetRoom: roomCode, pendingResyncRoomCode: null };
      if (!canEnterJoinOrResync(withTarget)) {
        return { snapshot, effects: [] };
      }
      return {
        snapshot: withMessage(
          { ...withTarget, state: 'resyncing' },
          'Syncing game state…',
        ),
        effects: [{ type: 'resync', roomCode }],
      };
    }

    case 'RESYNC_OK': {
      if (snapshot.state !== 'resyncing') {
        return { snapshot, effects: [] };
      }
      return applyPendingResyncAfterIdle(
        closeRecoveryEpisode({ ...snapshot, state: 'idle' }),
        [{ type: 'cancel_schedule' }],
      );
    }

    case 'RESYNC_FAIL': {
      if (snapshot.state !== 'resyncing') {
        return { snapshot, effects: [] };
      }
      if (event.terminal) {
        const roomCode = snapshot.targetRoom;
        return {
          snapshot: withMessage(clearedTerminal(snapshot), 'Match is no longer available.'),
          effects: [
            { type: 'cancel_schedule' },
            { type: 'clear_terminal_room', roomCode },
          ],
        };
      }
      const message = 'Sync failed. Retrying…';
      const exhausted = 'Could not sync room state.';
      return bumpAttemptOrFail(
        { ...snapshot, state: 'connecting' },
        message,
        exhausted,
      );
    }

    case 'MANUAL_JOIN': {
      const roomCode = normalizeRecoveryRoomCode(event.roomCode);
      if (!roomCode || snapshot.policy === 'disabled') {
        return { snapshot, effects: [] };
      }
      const next = withMessage(
        {
          ...nextEpisode({
            ...snapshot,
            state: 'joining',
            targetRoom: roomCode,
          }),
          manualRetry: true,
        },
        'Joining room…',
      );
      return {
        snapshot: next,
        effects: [
          { type: 'cancel_schedule' },
          { type: 'room_join', roomCode },
        ],
      };
    }

    case 'USER_RETRY': {
      if (!snapshot.targetRoom) {
        return { snapshot, effects: [] };
      }
      if (snapshot.policy === 'disabled') {
        return { snapshot, effects: [] };
      }
      const next = withMessage(
        {
          ...nextEpisode({
            ...snapshot,
            state: 'connecting',
          }),
          manualRetry: true,
        },
        'Retrying room connection…',
      );
      return {
        snapshot: next,
        effects: [
          { type: 'cancel_schedule' },
          { type: 'connect' },
        ],
      };
    }

    case 'USER_LEAVE':
      return {
        snapshot: closeRecoveryEpisode({
          ...snapshot,
          state: 'idle',
          policy: 'disabled',
          targetRoom: null,
        }),
        effects: [
          { type: 'cancel_schedule' },
          { type: 'clear_terminal_room', roomCode: snapshot.targetRoom },
        ],
      };

    case 'USER_DISMISS':
      return {
        snapshot: resetEpisode({
          ...snapshot,
          state: 'idle',
          targetRoom: null,
          policy: snapshot.policy === 'disabled' ? 'disabled' : 'manual_only',
        }),
        effects: [{ type: 'cancel_schedule' }],
      };

    case 'SESSION_SUPERSEDED': {
      const next = withMessage(
        closeRecoveryEpisode({
          ...snapshot,
          state: 'idle',
          policy: 'disabled',
          targetRoom: null,
          manualRetry: false,
        }),
        'Session moved to another tab.',
      );
      return {
        snapshot: next,
        effects: [{ type: 'cancel_schedule' }],
      };
    }

    case 'SCHEDULED_RETRY': {
      if (snapshot.state !== 'connecting') {
        return { snapshot, effects: [] };
      }
      return {
        snapshot,
        effects: [{ type: 'connect' }],
      };
    }

    default:
      return { snapshot, effects: [] };
  }
}

export type RecoveryMachine = {
  getSnapshot: () => RecoveryMachineSnapshot;
  dispatch: (event: RecoveryEvent) => RecoveryMachineSnapshot;
  dispose: () => void;
};

export function createRecoveryMachine(
  options: CreateRecoveryMachineOptions = {},
): RecoveryMachine {
  let snapshot = initialSnapshot(options.initialPolicy ?? 'auto');
  let scheduledEpisodeId: number | null = null;
  let dispatchEpoch = 0;

  const scheduler: Scheduler = options.scheduler ?? createDefaultScheduler();
  const onLog =
    options.onLog ??
    ((entry: RecoveryLogEntry) => {
      recordRecoveryTransition(entry);
      if (import.meta.env?.DEV) {
        console.warn(formatRecoveryLog(entry));
      }
    });
  const onEffect = options.onEffect;

  const runEffects = (from: RecoveryState, event: RecoveryEvent, effects: RecoveryEffect[]) => {
    for (const effect of effects) {
      if (effect.type === 'clear_terminal_room') {
        clearAllIngressState('terminal-reset');
      }
      if (effect.type === 'schedule') {
        scheduledEpisodeId = effect.episodeId;
        scheduler.schedule(effect.delayMs, () => {
          if (scheduledEpisodeId !== effect.episodeId) return;
          if (snapshot.episodeId !== effect.episodeId) return;
          dispatch({ type: 'SCHEDULED_RETRY' });
        });
      } else if (effect.type === 'cancel_schedule') {
        scheduledEpisodeId = null;
        scheduler.cancel();
      }
      onEffect?.(effect);
    }
    const to = snapshot.state;
    const shouldLog =
      from !== to ||
      effects.length > 0 ||
      (event.type !== 'SET_TARGET_ROOM' && event.type !== 'SET_POLICY');
    if (shouldLog) {
      onLog?.({
        from,
        to,
        event: event.type,
        attempt: snapshot.attempt,
        episodeId: snapshot.episodeId,
        policy: snapshot.policy,
        targetRoom: snapshot.targetRoom,
      });
    }
  };

  const getSnapshot = (): RecoveryMachineSnapshot => snapshot;

  const dispatch = (event: RecoveryEvent): RecoveryMachineSnapshot => {
    assertRecoveryAuthorityContractInDev();
    dispatchEpoch += 1;
    const currentEpoch = dispatchEpoch;

    if (
      snapshot.lastEpisodeClosedAt !== undefined &&
      isEpisodeStaleRecoveryEvent(snapshot, event)
    ) {
      return snapshot;
    }

    if (event.type === 'RESYNC_NEEDED') {
      if (snapshot.state === 'resyncing') {
        return snapshot;
      }
      if (
        event.episodeSequence !== undefined &&
        event.episodeSequence < snapshot.episodeId
      ) {
        return snapshot;
      }
    }

    const from = snapshot.state;
    const { snapshot: next, effects } = reduceRecovery(snapshot, event);

    if (currentEpoch !== dispatchEpoch) {
      return snapshot;
    }

    snapshot = next;
    if (shouldClearIngressOnRecoveryEvent(event, snapshot)) {
      clearAllIngressState('terminal-reset');
    }
    runEffects(from, event, effects);
    return snapshot;
  };

  const dispose = () => {
    scheduler.cancel();
    scheduledEpisodeId = null;
  };

  return { getSnapshot, dispatch, dispose };
}

function createDefaultScheduler(): Scheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(delayMs, cb) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        cb();
      }, delayMs);
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

export function formatRecoveryLog(entry: RecoveryLogEntry): string {
  const parts = [
    '[room:recovery]',
    `state=${entry.from}->${entry.to}`,
    `event=${entry.event}`,
    `attempt=${entry.attempt}`,
    `episode=${entry.episodeId}`,
    `policy=${entry.policy}`,
  ];
  if (entry.targetRoom) {
    parts.push(`room=${entry.targetRoom}`);
  }
  return parts.join(' ');
}

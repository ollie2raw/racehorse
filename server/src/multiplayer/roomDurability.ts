import { randomUUID } from 'crypto';
import type { Room } from '../rooms';

export type RoomDurabilityStatus = 'pending' | 'healthy' | 'degraded' | 'failed';

export type RoomDurabilityVersion = {
  asyncStateVersion: number;
  stateSequence: number | null;
  eventSequence: number;
};

export type RoomDurabilityFence = RoomDurabilityVersion & {
  commitId: string;
};

export type RoomDurabilityState = {
  status: RoomDurabilityStatus;
  targetVersion: RoomDurabilityVersion;
  targetFence: RoomDurabilityFence;
  persistedVersion: RoomDurabilityVersion | null;
  persistedFence: RoomDurabilityFence | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastAttemptedAtMs: number | null;
  lastPersistedAtMs: number | null;
};

export function captureRoomDurabilityVersion(room: Pick<Room, 'asyncStateVersion' | 'state' | 'eventSequence'>): RoomDurabilityVersion {
  return {
    asyncStateVersion: room.asyncStateVersion,
    stateSequence: typeof room.state?.sequence === 'number' ? room.state.sequence : null,
    eventSequence: room.eventSequence,
  };
}

export function captureRoomDurabilityFence(
  room: Pick<Room, 'asyncStateVersion' | 'state' | 'eventSequence'>,
  commitId: string = randomUUID(),
): RoomDurabilityFence {
  return {
    ...captureRoomDurabilityVersion(room),
    commitId,
  };
}

function sameRoomDurabilityVersion(
  left: RoomDurabilityVersion | null,
  right: RoomDurabilityVersion | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.asyncStateVersion === right.asyncStateVersion &&
    left.stateSequence === right.stateSequence &&
    left.eventSequence === right.eventSequence
  );
}

function sameRoomDurabilityFence(
  left: RoomDurabilityFence | null,
  right: RoomDurabilityFence | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.commitId === right.commitId && sameRoomDurabilityVersion(left, right);
}

export function createInitialRoomDurabilityState(
  room: Pick<Room, 'asyncStateVersion' | 'state' | 'eventSequence'>,
): RoomDurabilityState {
  const targetFence = captureRoomDurabilityFence(room);
  return {
    status: 'pending',
    targetVersion: { ...targetFence },
    targetFence,
    persistedVersion: null,
    persistedFence: null,
    consecutiveFailures: 0,
    lastError: null,
    lastAttemptedAtMs: null,
    lastPersistedAtMs: null,
  };
}

export function createHydratedRoomDurabilityState(
  room: Pick<Room, 'asyncStateVersion' | 'state' | 'eventSequence'>,
  persistedFence: RoomDurabilityFence,
): RoomDurabilityState {
  const version = captureRoomDurabilityVersion(room);
  const now = Date.now();
  return {
    status: 'healthy',
    targetVersion: version,
    persistedVersion: version,
    targetFence: persistedFence,
    persistedFence,
    consecutiveFailures: 0,
    lastError: null,
    lastAttemptedAtMs: now,
    lastPersistedAtMs: now,
  };
}

export function markRoomDurabilityPending(room: Room): void {
  const targetFence = captureRoomDurabilityFence(room);
  const current = room.durability;
  room.durability = {
    ...current,
    targetVersion: { ...targetFence },
    targetFence,
    status:
      current.status === 'healthy'
        ? 'pending'
        : current.status,
  };
}

export function markRoomDurabilityPersistSuccess(
  room: Room,
  persistedFence: RoomDurabilityFence,
): boolean {
  if (!sameRoomDurabilityFence(room.durability.targetFence, persistedFence)) {
    return false;
  }
  const version = captureRoomDurabilityVersion(room);
  const now = Date.now();
  room.durability = {
    status: 'healthy',
    targetVersion: version,
    persistedVersion: version,
    targetFence: persistedFence,
    persistedFence,
    consecutiveFailures: 0,
    lastError: null,
    lastAttemptedAtMs: now,
    lastPersistedAtMs: now,
  };
  return true;
}

export function markRoomDurabilityPersistFailure(
  room: Room,
  params: { status: 'degraded' | 'failed'; error: string },
  persistedFence?: RoomDurabilityFence,
): boolean {
  if (persistedFence && !sameRoomDurabilityFence(room.durability.targetFence, persistedFence)) {
    return false;
  }
  const version = captureRoomDurabilityVersion(room);
  room.durability = {
    ...room.durability,
    status: params.status,
    targetVersion: version,
    targetFence: persistedFence ?? room.durability.targetFence,
    consecutiveFailures: room.durability.consecutiveFailures + 1,
    lastError: params.error,
    lastAttemptedAtMs: Date.now(),
  };
  return true;
}

export function getRoomDurabilityState(room: Room): RoomDurabilityState {
  return room.durability;
}

export function isRoomDurablyRecoverable(room: Room): boolean {
  return (
    room.durability.status === 'healthy' &&
    sameRoomDurabilityVersion(room.durability.persistedVersion, captureRoomDurabilityVersion(room)) &&
    sameRoomDurabilityFence(room.durability.persistedFence, room.durability.targetFence)
  );
}

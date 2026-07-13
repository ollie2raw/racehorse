import type { RoomOperationEpochRef } from './runtime/roomOperationEpochTypes';

export type { RoomOperationEpochRef } from './runtime/roomOperationEpochTypes';

export function beginRoomOperation(epochRef: RoomOperationEpochRef): number {
  epochRef.current += 1;
  return epochRef.current;
}

export function invalidateRoomOperations(epochRef: RoomOperationEpochRef): number {
  epochRef.current += 1;
  return epochRef.current;
}

export function isCurrentRoomOperation(
  epochRef: RoomOperationEpochRef,
  token: number,
): boolean {
  return epochRef.current === token;
}

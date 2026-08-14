// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  beginRoomOperation,
  invalidateRoomOperations,
  isCurrentRoomOperation,
} from './roomOperationEpoch';

describe('roomOperationEpoch', () => {
  it('discards an older recovery join after supersession invalidates ownership', () => {
    const epochRef = { current: 0 };
    const recoveryJoin = beginRoomOperation(epochRef);

    invalidateRoomOperations(epochRef);

    expect(isCurrentRoomOperation(epochRef, recoveryJoin)).toBe(false);
    expect(epochRef.current).toBe(2);
  });

  it('discards a pending join after manual leave invalidates ownership', () => {
    const epochRef = { current: 4 };
    const pendingJoin = beginRoomOperation(epochRef);

    invalidateRoomOperations(epochRef);

    expect(isCurrentRoomOperation(epochRef, pendingJoin)).toBe(false);
  });

  it('lets a newer join supersede the previous join attempt', () => {
    const epochRef = { current: 0 };
    const firstJoin = beginRoomOperation(epochRef);
    const secondJoin = beginRoomOperation(epochRef);

    expect(isCurrentRoomOperation(epochRef, firstJoin)).toBe(false);
    expect(isCurrentRoomOperation(epochRef, secondJoin)).toBe(true);
  });

  it('discards stale saved-room autojoin after room/session cleanup', () => {
    const epochRef = { current: 8 };
    const savedRoomAutoJoin = beginRoomOperation(epochRef);

    invalidateRoomOperations(epochRef);

    expect(isCurrentRoomOperation(epochRef, savedRoomAutoJoin)).toBe(false);
  });

  it('discards stale resync after a newer authoritative operation advances the epoch', () => {
    const epochRef = { current: 0 };
    const resync = beginRoomOperation(epochRef);

    const newerSnapshotJoin = beginRoomOperation(epochRef);

    expect(isCurrentRoomOperation(epochRef, resync)).toBe(false);
    expect(isCurrentRoomOperation(epochRef, newerSnapshotJoin)).toBe(true);
  });
});

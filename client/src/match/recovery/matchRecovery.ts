/** Shared client recovery keys and localStorage helpers for live multiplayer rooms. */

export const LAST_ROOM_STORAGE_KEY = 'racehorse_last_room_code';

export const GUEST_ID_STORAGE_KEY = 'racehorse_guest_identity_v1';

export function normalizeStoredRoomCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function readLastRoomCode(): string {
  if (typeof window === 'undefined') return '';
  try {
    return normalizeStoredRoomCode(window.localStorage.getItem(LAST_ROOM_STORAGE_KEY));
  } catch {
    return '';
  }
}

export function saveLastRoomCode(roomCode: string): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeStoredRoomCode(roomCode);
  if (!normalized) return;
  try {
    window.localStorage.setItem(LAST_ROOM_STORAGE_KEY, normalized);
  } catch {
    // ignore quota / privacy mode
  }
}

export function clearLastRoomCode(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LAST_ROOM_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Whether an active joined room should be written to localStorage for reconnect.
 * Mirrors the guards in App's joinedRoom persistence effect.
 */
export function shouldPersistLastRoomCode(input: {
  joinedRoom: string | null;
  preventAutoRejoin: boolean;
  gameOver: boolean | undefined;
  isTerminalTournamentMatch: boolean;
}): boolean {
  if (!input.joinedRoom) return false;
  if (input.preventAutoRejoin) return false;
  if (input.gameOver) return false;
  if (input.isTerminalTournamentMatch) return false;
  return true;
}

export function readRoomInviteCodeFromLocation(): string {
  if (typeof window === 'undefined') return '';
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeStoredRoomCode(params.get('room'));
  } catch {
    return '';
  }
}

export function getOrCreateGuestIdentityId(): string {
  const fallback = () =>
    `guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  if (typeof window === 'undefined') return fallback();
  try {
    const existing = window.localStorage.getItem(GUEST_ID_STORAGE_KEY);
    if (existing?.startsWith('guest_')) return existing;
    const next = fallback();
    window.localStorage.setItem(GUEST_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return fallback();
  }
}

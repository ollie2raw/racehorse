// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  buildPendingInviteState,
  buildPrivateLobbyDuelViewModel,
  buildPrivateLobbyFooterHint,
  getFriendChallengeUiState,
  normalizeLobbyUsername,
} from './privateMatchLobbyViewModel';

describe('normalizeLobbyUsername', () => {
  it('strips leading @ symbols', () => {
    expect(normalizeLobbyUsername('@@player')).toBe('player');
  });
});

describe('getFriendChallengeUiState', () => {
  it('returns creating when user id matches', () => {
    expect(getFriendChallengeUiState('friend', 'uid-1', 'uid-1', null)).toBe('creating');
  });

  it('returns pending when challenge username matches', () => {
    expect(
      getFriendChallengeUiState(
        'friend',
        'uid-2',
        null,
        { friendUsername: '@friend', matchSummary: 'Bo3', expiresAt: Date.now() + 60_000 },
      ),
    ).toBe('pending');
  });
});

describe('buildPendingInviteState', () => {
  it('is inactive when guest is present', () => {
    const result = buildPendingInviteState(
      { friendUsername: 'a', matchSummary: 'x', expiresAt: Date.now() + 60_000 },
      true,
      Date.now(),
    );
    expect(result.pendingInviteActive).toBe(false);
  });

  it('is active before expiry with no guest', () => {
    const now = 1_000;
    const result = buildPendingInviteState(
      { friendUsername: 'rival', matchSummary: 'x', expiresAt: now + 5_000 },
      false,
      now,
    );
    expect(result.pendingInviteActive).toBe(true);
    expect(result.pendingInviteName).toBe('rival');
  });
});

describe('buildPrivateLobbyFooterHint', () => {
  it('shows waiting for ready when host and lobby error set', () => {
    expect(
      buildPrivateLobbyFooterHint({
        phase: 'room',
        lobbyError: 'waiting_for_ready',
        isRoomHost: true,
        playersCount: 2,
        pendingInviteActive: false,
        pendingInviteName: null,
      }),
    ).toBe('Waiting for opponent to ready up...');
  });
});

describe('buildPrivateLobbyDuelViewModel', () => {
  it('marks game 1 host name from myUsername in lobby phase', () => {
    const vm = buildPrivateLobbyDuelViewModel({
      phase: 'lobby',
      players: [],
      you: 'p1',
      myUsername: '@me',
      myRating: 1500,
    });
    expect(vm.leftPlainName).toBe('me');
    expect(vm.leftRatingStr).toBe('1,500');
    expect(vm.guestPresent).toBe(false);
  });
});
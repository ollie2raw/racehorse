// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { shouldShowPrivateMatchLobby } from './privateLobbyVisibility';

describe('shouldShowPrivateMatchLobby', () => {
  it('shows lobby when disconnected and not recovering', () => {
    expect(
      shouldShowPrivateMatchLobby({
        isConnected: false,
        isRecoveringConnection: false,
        joinedRoom: 'ROOM1',
        hasLiveGameState: true,
      }),
    ).toBe(true);
  });

  it('shows lobby when connected with no joined room', () => {
    expect(
      shouldShowPrivateMatchLobby({
        isConnected: true,
        isRecoveringConnection: false,
        joinedRoom: null,
        hasLiveGameState: false,
      }),
    ).toBe(true);
  });

  it('shows lobby when connected in a room without live game state', () => {
    expect(
      shouldShowPrivateMatchLobby({
        isConnected: true,
        isRecoveringConnection: false,
        joinedRoom: 'ROOM1',
        hasLiveGameState: false,
      }),
    ).toBe(true);
  });

  it('hides lobby when connected in a room with live game state', () => {
    expect(
      shouldShowPrivateMatchLobby({
        isConnected: true,
        isRecoveringConnection: false,
        joinedRoom: 'ROOM1',
        hasLiveGameState: true,
      }),
    ).toBe(false);
  });

  it('hides lobby when disconnected but recovering connection', () => {
    expect(
      shouldShowPrivateMatchLobby({
        isConnected: false,
        isRecoveringConnection: true,
        joinedRoom: null,
        hasLiveGameState: false,
      }),
    ).toBe(false);
  });
});
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PrivateMatchLobbyControlPanelProps } from './PrivateMatchLobbyControlPanel';

vi.mock('./usePrivateMatchLobbyFriends', () => ({
  usePrivateMatchLobbyFriends: () => ({ friends: [], friendsLoading: false, friendsError: '' }),
}));

const { PrivateMatchLobbyControlPanel } = await import('./PrivateMatchLobbyControlPanel');

function baseProps(
  overrides: Partial<PrivateMatchLobbyControlPanelProps> = {},
): PrivateMatchLobbyControlPanelProps {
  return {
    phase: 'lobby',
    isConnecting: false,
    serverWaking: false,
    onConnect: vi.fn(),
    roomCode: '',
    onRoomCodeChange: vi.fn(),
    onCreateRoom: vi.fn(),
    onJoinRoom: vi.fn(),
    pendingLobbyAction: null,
    joinedRoom: '',
    players: [],
    isRoomHost: false,
    onLeaveRoom: vi.fn(),
    onStartGame: vi.fn(),
    pendingStart: false,
    onCopyInviteLink: vi.fn(),
    onCopyRoomCode: vi.fn(),
    roomRecoveryState: 'idle',
    roomRecoveryMessage: '',
    onRetryRoomRecovery: vi.fn(),
    winTarget: 60,
    isRatedEligible: false,
    pendingChallenge: null,
    pendingInviteActive: false,
    pendingInviteName: null,
    lobbyError: '',
    socket: null,
    ...overrides,
  };
}

describe('PrivateMatchLobbyControlPanel — redesigned panel', () => {
  it('create lobby: shows the three converged sections and drops the retired controls', () => {
    render(<PrivateMatchLobbyControlPanel {...baseProps()} />);

    const labels = Array.from(document.querySelectorAll('.fritz-section-label')).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(['Format', 'Invite', 'Match Summary']);
    expect(screen.getByRole('heading', { name: 'Private 1v1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '7 Tiles' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '14 Tiles' })).toBeInTheDocument();

    // retired: privacy tiles, mini-tile settings strip, "coming soon" placeholders
    expect(screen.queryByText(/Lobby privacy/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Match settings/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Custom Rules/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Friends Only/i)).not.toBeInTheDocument();

    // create/join switch stays — the join flow needs it
    expect(screen.getByRole('tab', { name: /Create lobby/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Join lobby/i })).toBeInTheDocument();
  });

  it('room phase: room code renders inside the invite section, format shows as locked', () => {
    render(
      <PrivateMatchLobbyControlPanel
        {...baseProps({
          phase: 'room',
          joinedRoom: 'U8YZ8',
          isRoomHost: true,
          players: [{ userId: 'h', username: 'host', seat: 0 } as never],
        })}
      />,
    );

    const code = document.querySelector('.pml-roomcode-bar-code');
    expect(code).not.toBeNull();
    expect(code).toHaveTextContent('U8YZ8');
    expect(screen.getByText('Invite')).toBeInTheDocument();
    expect(screen.getByText(/locked in/i)).toBeInTheDocument();
    // the old sliding top bar is gone
    expect(document.querySelector('.pml-roomcode-bar')).toBeNull();
  });

  it('join lobby tab still exposes the room-code input', async () => {
    const { rerender } = render(<PrivateMatchLobbyControlPanel {...baseProps()} />);
    rerender(<PrivateMatchLobbyControlPanel {...baseProps()} />);
    screen.getByRole('tab', { name: /Join lobby/i }).click();
    expect(await screen.findByPlaceholderText('ROOM CODE')).toBeInTheDocument();
  });
});

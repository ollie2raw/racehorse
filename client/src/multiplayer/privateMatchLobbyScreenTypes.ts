import type { AppMode } from '../types';
import type { PrivateRoomCreateSettings } from './roomTransport';
import type { Socket } from 'socket.io-client';
import type { RoomChatEvent, RoomEmoteEvent } from './protocol';
import type { RoomPlayer, RoomRecoveryState } from './protocol';
import type {
  FriendChallengeTarget,
  SendFriendChallengeResult,
} from './friendChallenge';

export type { RoomRecoveryState };

export type PrivateMatchLobbyPhase = 'disconnected' | 'lobby' | 'room';

export interface PrivateMatchLobbyScreenProps {
  phase: PrivateMatchLobbyPhase;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
  onBackHome: () => void;

  isConnecting: boolean;
  serverWaking: boolean;
  serverUrl: string;
  onConnect: () => void;

  roomCode: string;
  onRoomCodeChange: (code: string) => void;
  onCreateRoom: (settings: PrivateRoomCreateSettings) => void;
  onJoinRoom: () => void;
  pendingLobbyAction: null | 'create' | 'join';

  joinedRoom: string;
  players: RoomPlayer[];
  you: string | null;
  isRoomHost: boolean;
  onLeaveRoom: () => void;
  onStartGame: () => void;
  pendingStart: boolean;
  onCopyInviteLink: () => void;
  onCopyRoomCode?: () => void;
  roomRecoveryState: RoomRecoveryState;
  roomRecoveryMessage: string;
  onRetryRoomRecovery: () => void;

  myRating?: number | null;
  myUsername?: string | null;
  hostWinStreak?: number | null;
  roomChatFeed?: Array<RoomChatEvent | RoomEmoteEvent>;
  onSendRoomChat?: (text: string) => void;
  winTarget?: number;
  isRatedEligible?: boolean;
  onOpenQuickMatch?: () => void;
  socket?: Socket | null;
  pendingChallenge?: {
    friendUsername: string;
    matchSummary: string;
    expiresAt: number;
  } | null;
  lobbyError?: string;
  sendFriendChallenge?: (target: FriendChallengeTarget) => Promise<SendFriendChallengeResult>;
}

export type PendingChallenge = NonNullable<PrivateMatchLobbyScreenProps['pendingChallenge']>;
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import type { GhostProfileSummary } from '../ghost/api';
import type { AppMode } from '../types';
import type {
  DailyFritzSetGameNumber,
  DailyFritzSetGameResult,
  DailyFritzSetResult,
} from './api';

export type BetweenGameTrackerTone = 'win' | 'loss' | 'next' | 'idle';

export type DailyFritzInitPhase = 'preparing' | 'still-preparing' | 'failed' | 'retrying' | 'ready';

export type DailyFritzGameCardState = 'active' | 'won' | 'lost' | 'locked' | 'not-needed' | 'pending';

export interface OverlayTrackerItem {
  gameNumber: DailyFritzSetGameNumber;
  label: string;
  tone: BetweenGameTrackerTone;
}

export interface OverlayGameItem {
  gameNumber: DailyFritzSetGameNumber;
  value: string;
  tone: 'win' | 'loss';
  playerScore: number;
  fritzScore: number;
  skunk?: boolean;
  skunkLabel?: string | null;
}

export interface DailyFritzScreenProps {
  user: User | null;
  profile: UserProfile | null;
  ghostProfile: GhostProfileSummary | null;
  onGhostProfileChange: (profile: GhostProfileSummary | null) => void;
  onProfileRefresh?: () => Promise<void> | void;
  onProfilePatch?: (patch: Partial<UserProfile>) => void;
  onOpenAuth: () => void;
  onOpenAccount?: () => void;
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
}

export type DailyFritzOverlayState =
  | {
      kind: 'saving';
      completedGame: DailyFritzSetGameResult;
      message: string;
    }
  | {
      kind: 'record-error';
      completedGame: DailyFritzSetGameResult;
      message: string;
      error: string;
      game: DailyFritzGameCompletionPayload;
    }
  | {
      kind: 'between';
      completedGame: DailyFritzSetGameResult;
      setResult: DailyFritzSetResult;
      nextGameNumber: DailyFritzSetGameNumber;
    }
  | {
      kind: 'finalizing';
      completedGame: DailyFritzSetGameResult;
      setResult: DailyFritzSetResult;
      message: string;
      currentHandIndex: number;
    }
  | {
      kind: 'final-error';
      completedGame: DailyFritzSetGameResult;
      setResult: DailyFritzSetResult;
      error: string;
      currentHandIndex: number;
    }
  | {
      kind: 'final';
      completedGame: DailyFritzSetGameResult;
      setResult: DailyFritzSetResult;
      rank: number | null;
      canViewLeaderboard: boolean;
    };

export interface DailyFritzGameCompletionPayload {
  winner: 'you' | 'bot' | null;
  yourScore: number;
  botScore: number;
  movesUsed: number;
  handsPlayed: number;
  currentHandIndex: number;
  moveLog: unknown;
}

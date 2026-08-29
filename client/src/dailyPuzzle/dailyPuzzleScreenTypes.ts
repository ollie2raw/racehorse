import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import type { AppMode } from '../types';
import type { CuratedDailyPuzzle, PuzzleValidationResult } from './types';

export interface DailyPuzzleScreenProps {
  user: User | null;
  profile: UserProfile | null;
  initialView?: 'hub' | 'leaderboard';
  onLeaderboardClose?: () => void;
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
}

export type PlayStatus = 'IN_PROGRESS' | 'SOLVED' | 'FAILED';

export interface DailyProgress {
  attempts: number;
  bestMoves: number | null;
  lastResult: PlayStatus | null;
}

export type ValidatorWorkerRequest =
  | { requestId: number; type: 'validate'; puzzleDate: string; puzzle: CuratedDailyPuzzle }
  | { requestId: number; type: 'bestScore'; puzzleDate: string; puzzle: CuratedDailyPuzzle };

export type ValidatorWorkerResponse =
  | { requestId: number; type: 'validateResult'; puzzleDate: string; result: PuzzleValidationResult }
  | { requestId: number; type: 'bestScoreResult'; puzzleDate: string; score: number }
  | { requestId: number; type: 'error'; puzzleDate: string; error: string };

export interface PendingWorkerJob<T> {
  expected: 'validateResult' | 'bestScoreResult';
  puzzleDate: string;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

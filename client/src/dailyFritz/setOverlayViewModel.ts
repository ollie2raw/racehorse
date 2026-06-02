import type { DailyFritzSetGameNumber } from './api';

export type DailyFritzSetOverlayKind =
  | 'between'
  | 'final'
  | 'saving'
  | 'record-error'
  | 'finalizing'
  | 'final-error';

export interface DailyFritzSetOverlayViewModel {
  kind: DailyFritzSetOverlayKind;
  eyebrow: string;
  headline: string;
  subheadline: string;
  objective: string | null;
  nextLabel: string | null;
  primaryLabel: string;
  primaryTone: 'default' | 'decider' | 'success';
  primaryDisabled?: boolean;
  secondaryLabel: string | null;
  errorMessage?: string | null;
  gameScoreLabel: string;
  gameScoreValue: string;
  setScoreValue: string;
  marginValue: string;
  marginTone: 'win' | 'loss' | 'idle';
  resultValue: string | null;
  rankValue: string | null;
  skunkBadge: string | null;
  shareDate?: string;
  shareTier?: string;
  shareRating?: number;
  shareStreak?: number;
  tracker: Array<{
    gameNumber: DailyFritzSetGameNumber;
    label: string;
    tone: 'win' | 'loss' | 'next' | 'idle';
  }>;
  games: Array<{
    gameNumber: DailyFritzSetGameNumber;
    value: string;
    tone: 'win' | 'loss';
    playerScore: number;
    fritzScore: number;
    skunk?: boolean;
    skunkLabel?: string | null;
  }>;
  practiceHint?: string | null;
  onPrimary: () => void;
  onSecondary: () => void;
}

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
  tertiaryLabel?: string | null;
  errorMessage?: string | null;
  gameScoreLabel: string;
  gameScoreValue: string;
  setScoreValue: string;
  marginValue: string;
  marginTone: 'win' | 'loss' | 'idle';
  resultValue: string | null;
  rankValue: string | null;
  skunkBadge: string | null;
  /** False when the run finished without a verified receipt. */
  ranked?: boolean;
  /** A lost set that still leaves the daily streak intact. */
  streakHeld?: boolean;
  /** Explanatory paragraph under the stat grid (loss / unranked only). */
  note?: string | null;
  /** Bare ordinal rank for the dossier stat grid, e.g. "1st". */
  rankShort?: string | null;
  shareDate?: string;
  shareRunDate?: string;
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
  /** Em-dash / incomplete stats while saving or posting */
  statsPending?: boolean;
  onPrimary: () => void;
  onSecondary: () => void;
  onTertiary?: () => void;
}

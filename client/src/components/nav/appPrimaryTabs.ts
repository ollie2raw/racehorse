import type { AppMode } from '../../types';
import type { PrimaryArea } from '../../presentation/surfacePresentation';

export type AppPrimaryTab = {
  label: string;
  shortLabel: string;
  mode: AppMode;
  area: PrimaryArea;
  activeModes: AppMode[];
};

export const APP_PRIMARY_TABS: AppPrimaryTab[] = [
  {
    label: 'Multiplayer',
    area: 'multiplayer',
    shortLabel: 'Multi',
    mode: 'multiplayer',
    activeModes: ['multiplayer'],
  },
  {
    label: 'Single Player',
    area: 'solo',
    shortLabel: 'Solo',
    mode: 'singlePlayerHub',
    activeModes: [
      'singlePlayerHub',
      'journey',
      'botSetup',
      'ghostSetup',
      'dailyFritz',
      'dailyFritzLeaderboard',
    ],
  },
  {
    label: 'Tournament',
    area: 'tournament',
    shortLabel: 'Tourny',
    mode: 'tournament',
    activeModes: ['tournament'],
  },
  {
    label: 'Social',
    area: 'social',
    shortLabel: 'Social',
    mode: 'feed',
    activeModes: ['feed', 'friends', 'leaderboard', 'profile', 'stats', 'ratingHistory'],
  },
  {
    label: 'Learn',
    area: 'learn',
    shortLabel: 'Learn',
    mode: 'learn',
    activeModes: ['learn', 'noBrainer', 'guidedMatchRecorder', 'guidedMatchAnnotator'],
  },
];

export const APP_PRIMARY_TAB_COLORS: Record<string, string> = {
  'Single Player': '#9B6CFF',
  Multiplayer: '#3FA7FF',
  Learn: '#19D8A2',
  Tournament: '#F5A524',
  Social: '#0ea5e9',
};

/**
 * The nav accent each mode registers once its (lazy) screen mounts — see the
 * `activeColor` each screen passes to GlobalNav. The shell uses it before
 * that, so the active tab never flashes the section default (Single Player's
 * purple) while Daily Fritz / Puzzle Rush load. Keep in sync with the screens.
 */
export const MODE_NAV_ACCENT: Partial<Record<AppMode, string>> = {
  singlePlayerHub: '#E7B64A',
  dailyFritz: 'var(--tier-elite)',
  dailyFritzLeaderboard: 'var(--tier-elite)',
  puzzleRush: 'var(--tier-standard)',
};

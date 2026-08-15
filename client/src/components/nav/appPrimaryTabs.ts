import type { AppMode } from '../../types';

export type AppPrimaryTab = {
  label: string;
  shortLabel: string;
  mode: AppMode;
  activeModes: AppMode[];
};

export const APP_PRIMARY_TABS: AppPrimaryTab[] = [
  {
    label: 'Multiplayer',
    shortLabel: 'Multi',
    mode: 'multiplayer',
    activeModes: ['multiplayer'],
  },
  {
    label: 'Single Player',
    shortLabel: 'Solo',
    mode: 'singlePlayerHub',
    activeModes: [
      'singlePlayerHub',
      'journey',
      'botSetup',
      'ghostSetup',
      'dailyFritz',
      'dailyFritzLeaderboard',
      'daily',
      'dailyPuzzleLeaderboard',
    ],
  },
  {
    label: 'Tournament',
    shortLabel: 'Tourny',
    mode: 'tournament',
    activeModes: ['tournament'],
  },
  {
    label: 'Social',
    shortLabel: 'Social',
    mode: 'feed',
    activeModes: ['feed', 'friends', 'leaderboard', 'profile', 'stats', 'ratingHistory'],
  },
  {
    label: 'Learn',
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

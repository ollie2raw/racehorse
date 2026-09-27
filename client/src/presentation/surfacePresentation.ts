import type { AppMode } from '../types';

export type PrimaryArea = 'multiplayer' | 'solo' | 'tournament' | 'social' | 'learn';
export type SurfacePresentation = {
  shell: 'hub' | 'focused' | 'gameplay' | 'utility';
  primaryArea: PrimaryArea | null;
  chrome: 'hub-tabs' | 'contextual' | 'none';
  parentMode?: AppMode;
  scroll: 'bounded-page' | 'named-content' | 'none';
  account: 'compact' | 'avatar' | 'hidden';
};

const hub = (primaryArea: PrimaryArea | null): SurfacePresentation => ({
  shell: 'hub', primaryArea, chrome: 'hub-tabs', scroll: 'bounded-page', account: 'compact',
});
const focused = (primaryArea: PrimaryArea, parentMode: AppMode): SurfacePresentation => ({
  shell: 'focused', primaryArea, chrome: 'contextual', parentMode,
  scroll: 'named-content', account: 'avatar',
});
const gameplay: SurfacePresentation = {
  shell: 'gameplay', primaryArea: null, chrome: 'none', scroll: 'none', account: 'hidden',
};

/** Exhaustive presentation metadata; route, domain state and URL remain in their existing owners. */
export const SURFACE_BY_MODE: Record<AppMode, SurfacePresentation> = {
  home: hub(null),
  multiplayer: hub('multiplayer'),
  singlePlayerHub: hub('solo'),
  tournament: hub('tournament'),
  feed: hub('social'),
  learn: hub('learn'),
  botSetup: focused('solo', 'singlePlayerHub'),
  ghostSetup: focused('solo', 'singlePlayerHub'),
  dailyFritz: focused('solo', 'home'),
  dailyFritzLeaderboard: focused('solo', 'dailyFritz'),
  journey: focused('solo', 'singlePlayerHub'),
  puzzleRush: focused('solo', 'singlePlayerHub'),
  noBrainer: focused('learn', 'learn'),
  guidedMatchRecorder: focused('learn', 'learn'),
  guidedMatchAnnotator: focused('learn', 'learn'),
  friends: focused('social', 'feed'),
  stats: focused('social', 'feed'),
  ratingHistory: focused('social', 'stats'),
  leaderboard: focused('social', 'feed'),
  profile: focused('social', 'feed'),
  live: focused('social', 'feed'),
  bot: gameplay,
  ghost: gameplay,
  settings: { shell: 'utility', primaryArea: null, chrome: 'contextual', parentMode: 'home', scroll: 'named-content', account: 'avatar' },
  dailyFritzHealthAdmin: { shell: 'utility', primaryArea: null, chrome: 'none', scroll: 'named-content', account: 'hidden' },
};

export type SurfaceContext = {
  mode: AppMode;
  joinedMatch: boolean;
  tournamentView: 'hub' | 'bracket' | 'result';
  learnLessonOpen: boolean;
};

/** Explicit state refinements for modes that own multiple visible surfaces. */
export function resolveSurfacePresentation(context: SurfaceContext): SurfacePresentation {
  if (context.joinedMatch) return gameplay;
  if (context.mode === 'tournament' && context.tournamentView !== 'hub') {
    return focused('tournament', 'tournament');
  }
  if (context.mode === 'learn' && context.learnLessonOpen) {
    return focused('learn', 'learn');
  }
  return SURFACE_BY_MODE[context.mode];
}

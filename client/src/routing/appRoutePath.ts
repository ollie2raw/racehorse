import type { AppMode } from '../appRouteTypes';

export type AppRouteResolution = {
  mode: AppMode;
  multiplayerView?: 'quick' | 'private';
  profileUsername?: string;
  learnHowToPlay?: boolean;
  tournamentId?: string;
  tournamentView?: 'bracket' | 'result';
};

export type AppPathState = {
  mode: AppMode;
  multiplayerView: 'quick' | 'private';
  profileUsername: string | null;
  learnHowToPlay: boolean;
  tournamentId: string | null;
  tournamentView: 'hub' | 'bracket' | 'result';
};

const STATIC_PATHS: Record<string, AppRouteResolution> = {
  '/': { mode: 'home' },
  '/stats': { mode: 'stats' },
  '/friends': { mode: 'friends' },
  '/daily': { mode: 'daily' },
  '/daily/leaderboard': { mode: 'dailyPuzzleLeaderboard' },
  '/daily-fritz': { mode: 'dailyFritz' },
  '/daily-fritz/leaderboard': { mode: 'dailyFritzLeaderboard' },
  '/rating-history': { mode: 'ratingHistory' },
  '/solo': { mode: 'singlePlayerHub' },
  '/solo/fritz': { mode: 'botSetup' },
  '/solo/ghost': { mode: 'ghostSetup' },
  '/journey': { mode: 'journey' },
  '/tournament': { mode: 'tournament' },
  '/practice': { mode: 'noBrainer' },
  '/learn': { mode: 'learn' },
  '/learn/how-to-play': { mode: 'learn', learnHowToPlay: true },
  '/learn/recorder': { mode: 'guidedMatchRecorder' },
  '/learn/guided-annotator': { mode: 'guidedMatchAnnotator' },
  '/multiplayer': { mode: 'multiplayer', multiplayerView: 'quick' },
  '/multiplayer/private': { mode: 'multiplayer', multiplayerView: 'private' },
  '/social': { mode: 'feed' },
};

function normalizePathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

function decodeSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded && !decoded.includes('/') ? decoded : null;
  } catch {
    return null;
  }
}

export function resolveAppRoute(pathname: string): AppRouteResolution {
  const normalized = normalizePathname(pathname);
  const staticRoute = STATIC_PATHS[normalized];
  if (staticRoute) return staticRoute;

  const profileMatch = normalized.match(/^\/players\/([^/]+)$/);
  if (profileMatch) {
    const profileUsername = decodeSegment(profileMatch[1]!);
    if (profileUsername) return { mode: 'profile', profileUsername };
  }

  const tournamentResultMatch = normalized.match(/^\/tournament\/([^/]+)\/result$/);
  if (tournamentResultMatch) {
    const tournamentId = decodeSegment(tournamentResultMatch[1]!);
    if (tournamentId) return { mode: 'tournament', tournamentId, tournamentView: 'result' };
  }

  const tournamentMatch = normalized.match(/^\/tournament\/([^/]+)$/);
  if (tournamentMatch) {
    const tournamentId = decodeSegment(tournamentMatch[1]!);
    if (tournamentId) return { mode: 'tournament', tournamentId, tournamentView: 'bracket' };
  }

  return { mode: 'home' };
}

export function buildAppPath(state: AppPathState): string {
  if (state.mode === 'profile' && state.profileUsername) {
    return `/players/${encodeURIComponent(state.profileUsername.replace(/^@/, ''))}`;
  }
  if (state.mode === 'tournament' && state.tournamentId) {
    const base = `/tournament/${encodeURIComponent(state.tournamentId)}`;
    if (state.tournamentView === 'result') return `${base}/result`;
    if (state.tournamentView === 'bracket') return base;
  }
  if (state.mode === 'multiplayer') {
    return state.multiplayerView === 'private' ? '/multiplayer/private' : '/multiplayer';
  }
  if (state.mode === 'learn' && state.learnHowToPlay) return '/learn/how-to-play';

  const paths: Partial<Record<AppMode, string>> = {
    home: '/',
    stats: '/stats',
    friends: '/friends',
    daily: '/daily',
    dailyPuzzleLeaderboard: '/daily/leaderboard',
    dailyFritz: '/daily-fritz',
    dailyFritzLeaderboard: '/daily-fritz/leaderboard',
    ratingHistory: '/rating-history',
    singlePlayerHub: '/solo',
    botSetup: '/solo/fritz',
    ghostSetup: '/solo/ghost',
    journey: '/journey',
    tournament: '/tournament',
    noBrainer: '/practice',
    learn: '/learn',
    guidedMatchRecorder: '/learn/recorder',
    guidedMatchAnnotator: '/learn/guided-annotator',
    feed: '/social',
    leaderboard: '/social',
  };

  // Active Fritz, Ghost, and Journey trial matches intentionally retain the
  // existing root-path behavior until their session state can be hydrated.
  return paths[state.mode] ?? '/';
}

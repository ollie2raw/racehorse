import { useState, useEffect, useRef } from 'react';
import type { AppMode } from '../appRouteTypes';
import { LEARN_MODE_VISIBLE, JOURNEY_MODE_VISIBLE } from '../appRouteTypes';
import { resolveAppRoute, buildAppPath } from './appRoutePath';

export type UseAppRouteStateParams = {
  activeTournamentId: string | null;
  tournamentSubView: 'hub' | 'bracket' | 'result';
  setActiveTournamentId: (id: string | null) => void;
  setTournamentSubView: (view: 'hub' | 'bracket' | 'result') => void;
};

export type UseAppRouteStateResult = {
  appMode: AppMode;
  setAppMode: React.Dispatch<React.SetStateAction<AppMode>>;
  appModeRef: React.MutableRefObject<AppMode>;
  routeReady: boolean;
  setRouteReady: React.Dispatch<React.SetStateAction<boolean>>;
  mpSubView: 'quick' | 'private';
  setMpSubView: React.Dispatch<React.SetStateAction<'quick' | 'private'>>;
  mpSubViewRef: React.MutableRefObject<'quick' | 'private'>;
  learnHowToPlayOpen: boolean;
  setLearnHowToPlayOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedLearnLessonId: string | null;
  setSelectedLearnLessonId: React.Dispatch<React.SetStateAction<string | null>>;
  profileTarget: string | null;
  setProfileTarget: React.Dispatch<React.SetStateAction<string | null>>;
  profileOriginMode: AppMode | null;
  setProfileOriginMode: React.Dispatch<React.SetStateAction<AppMode | null>>;
};

export function useAppRouteState(params: UseAppRouteStateParams): UseAppRouteStateResult {
  const { activeTournamentId, tournamentSubView, setActiveTournamentId, setTournamentSubView } =
    params;

  const initialRouteRef = useRef(resolveAppRoute(window.location.pathname));
  const initialDynamicRouteAppliedRef = useRef(false);
  const browserNavigationRef = useRef(false);

  const [appMode, setAppMode] = useState<AppMode>(initialRouteRef.current.mode);
  const [routeReady, setRouteReady] = useState(!initialRouteRef.current.tournamentId);
  const [selectedLearnLessonId, setSelectedLearnLessonId] = useState<string | null>(null);
  const [learnHowToPlayOpen, setLearnHowToPlayOpen] = useState(
    Boolean(initialRouteRef.current.learnHowToPlay),
  );
  const [mpSubView, setMpSubView] = useState<'quick' | 'private'>(
    initialRouteRef.current.multiplayerView ?? 'quick',
  );
  const [profileTarget, setProfileTarget] = useState<string | null>(
    initialRouteRef.current.profileUsername ?? null,
  );
  const [profileOriginMode, setProfileOriginMode] = useState<AppMode | null>(null);

  const appModeRef = useRef(appMode);
  const mpSubViewRef = useRef(mpSubView);

  useEffect(() => {
    appModeRef.current = appMode;
  }, [appMode]);

  useEffect(() => {
    mpSubViewRef.current = mpSubView;
  }, [mpSubView]);

  // Mode guard: LEARN_MODE_VISIBLE
  useEffect(() => {
    if (!LEARN_MODE_VISIBLE && appMode === 'learn') {
      setSelectedLearnLessonId(null);
      setLearnHowToPlayOpen(false);
      setAppMode('singlePlayerHub');
    }
  }, [appMode]);

  // Mode guard: JOURNEY_MODE_VISIBLE
  useEffect(() => {
    if (!JOURNEY_MODE_VISIBLE && appMode === 'journey') {
      setAppMode('singlePlayerHub');
    }
  }, [appMode]);

  // Clear learnHowToPlayOpen when leaving learn
  useEffect(() => {
    if (appMode !== 'learn') {
      setLearnHowToPlayOpen(false);
    }
  }, [appMode]);

  // One-shot tournament bootstrap from initial URL
  useEffect(() => {
    if (initialDynamicRouteAppliedRef.current) return;
    initialDynamicRouteAppliedRef.current = true;
    const initialRoute = initialRouteRef.current;
    if (!initialRoute.tournamentId) return;

    setActiveTournamentId(initialRoute.tournamentId);
    setTournamentSubView(initialRoute.tournamentView ?? 'bracket');
    setRouteReady(true);
  }, [setActiveTournamentId, setTournamentSubView]);

  // Browser back/forward navigation
  useEffect(() => {
    const applyBrowserRoute = () => {
      browserNavigationRef.current = true;
      const route = resolveAppRoute(window.location.pathname);
      setAppMode(route.mode);
      setLearnHowToPlayOpen(Boolean(route.learnHowToPlay));
      setSelectedLearnLessonId(null);

      if (route.multiplayerView) setMpSubView(route.multiplayerView);
      if (route.profileUsername) {
        setProfileTarget(route.profileUsername);
        setProfileOriginMode(null);
      }

      if (route.mode === 'tournament') {
        setActiveTournamentId(route.tournamentId ?? null);
        setTournamentSubView(route.tournamentView ?? 'hub');
      }
    };

    window.addEventListener('popstate', applyBrowserRoute);
    return () => window.removeEventListener('popstate', applyBrowserRoute);
  }, [setActiveTournamentId, setTournamentSubView]);

  // Sync URL to state
  useEffect(() => {
    if (!routeReady) return;
    const nextPath = buildAppPath({
      mode: appMode,
      multiplayerView: mpSubView,
      profileUsername: profileTarget,
      learnHowToPlay: learnHowToPlayOpen,
      tournamentId: activeTournamentId,
      tournamentView: tournamentSubView,
    });
    const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
    if (browserNavigationRef.current) {
      if (currentPath === nextPath) browserNavigationRef.current = false;
      return;
    }
    if (currentPath !== nextPath) {
      window.history.pushState(window.history.state, '', nextPath);
    }
  }, [
    activeTournamentId,
    appMode,
    learnHowToPlayOpen,
    mpSubView,
    profileTarget,
    routeReady,
    tournamentSubView,
  ]);

  return {
    appMode,
    setAppMode,
    appModeRef,
    routeReady,
    setRouteReady,
    mpSubView,
    setMpSubView,
    mpSubViewRef,
    learnHowToPlayOpen,
    setLearnHowToPlayOpen,
    selectedLearnLessonId,
    setSelectedLearnLessonId,
    profileTarget,
    setProfileTarget,
    profileOriginMode,
    setProfileOriginMode,
  };
}

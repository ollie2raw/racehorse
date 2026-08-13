import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDeferredAsset } from '../ui/useDeferredAsset';
import '../screens/RacehorseHomeArt.css';

import { normalizeSetResult } from './dailyFritzScreenHelpers';
import type { DailyFritzScreenProps } from './dailyFritzScreenTypes';
import { DailyFritzLoadingScreen } from './DailyFritzLoadingScreen';
import { useDailyFritzInit } from './useDailyFritzInit';
import { useDailyFritzRunController } from './useDailyFritzRunController';
import { buildDailyFritzSetOverlayViewModel } from './buildDailyFritzSetOverlayViewModel';
import { buildDailyFritzHubViewModel } from './dailyFritzHubViewModel';
import { DailyFritzHubView } from './DailyFritzHubView';
import { DailyFritzEmbeddedMatchView } from './DailyFritzEmbeddedMatchView';
import './dailyFritz.css';

export default function DailyFritzScreen({
  user,
  profile,
  ghostProfile,
  onGhostProfileChange,
  onProfileRefresh,
  onProfilePatch,
  onOpenAuth,
  onOpenAccount,
  onBack,
  onNavigate,
  socket,
}: DailyFritzScreenProps) {
  const {
    today,
    initPhase,
    loadError,
    initRetryPending,
    hubError,
    setHubError,
    refreshToday,
    runInit,
    showInitScreen,
  } = useDailyFritzInit({ userId: user?.id });

  const {
    activeRun,
    embeddedMatchKey,
    setOverlay,
    startActionPending,
    dailyFritzPackageForMatch,
    beginRun,
    continueSet,
    closeEmbeddedRun,
    finishEmbeddedRun,
    handleDailyFritzGameComplete,
    clearSetOverlay,
    retryFinalSubmission,
    hasEmbeddedMatch,
  } = useDailyFritzRunController({
    today,
    hubError,
    setHubError,
    refreshToday,
  });

  const [countdownTick, setCountdownTick] = useState(0);

  const loadHeroAsset = useCallback(
    () => import('../assets/dailyFritz/playvsfritzdone.webp'),
    [],
  );
  const heroSrc = useDeferredAsset('daily-fritz-hero', loadHeroAsset);

  // Do not tick the lobby countdown while an embedded match is open. A 1 Hz
  // parent re-render recreates inline props and was resetting Daily Fritz
  // hand-transition timers in BotMatchScreen (advanceHand identity churn).
  useEffect(() => {
    if (activeRun) return;
    const id = window.setInterval(() => setCountdownTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [activeRun]);

  const loadToday = refreshToday;

  const openLeaderboard = useCallback(() => {
    onNavigate?.('dailyFritzLeaderboard');
  }, [onNavigate]);

  const openLeaderboardForRunDate = useCallback(() => {
    onNavigate?.('dailyFritzLeaderboard');
  }, [onNavigate]);

  const handleSetAction = useCallback(() => {
    if (today?.attempt_status === 'completed') { openLeaderboard(); return; }
    const isStarted = today?.attempt_status === 'started';
    if (isStarted) {
      void continueSet();
      return;
    }
    void beginRun();
  }, [beginRun, continueSet, openLeaderboard, today?.attempt_status]);

  const setOverlayConfig = useMemo(() => {
    if (!setOverlay) return null;
    return buildDailyFritzSetOverlayViewModel(
      setOverlay,
      {
        continueSet: () => {
          void continueSet();
        },
        submitCompletedGame: (game) => {
          void handleDailyFritzGameComplete(game);
        },
        closeEmbeddedRun,
        loadToday: () => {
          void loadToday();
        },
        openLeaderboardForRunDate,
        clearOverlay: clearSetOverlay,
        retryFinalSubmission: () => { void retryFinalSubmission(); },
        startPractice: () => { clearSetOverlay(); closeEmbeddedRun(); onNavigate?.('botSetup'); },
      },
      {
        todayRunDate: today?.run_date,
        todayStreak: today?.streak,
        todayFritzTier: today?.fritz_tier,
        activeRunDate: activeRun?.run_date,
        activeFritzTier: activeRun?.fritz_tier,
        profileGlickoRating: profile?.glicko_rating,
      },
    );
  }, [
    setOverlay,
    continueSet,
    loadToday,
    today,
    activeRun,
    profile?.glicko_rating,
    openLeaderboardForRunDate,
    handleDailyFritzGameComplete,
    closeEmbeddedRun,
    clearSetOverlay,
    retryFinalSubmission,
  ]);

  const todaySetResult = useMemo(
    () => normalizeSetResult(today?.set_result ?? today?.result),
    [today],
  );

  const hubViewModel = useMemo(
    () => buildDailyFritzHubViewModel(today, todaySetResult, countdownTick, startActionPending, Boolean(user)),
    [today, todaySetResult, countdownTick, startActionPending, user],
  );

  if (hasEmbeddedMatch && activeRun && embeddedMatchKey) {
    return (
      <DailyFritzEmbeddedMatchView
        embeddedMatchKey={embeddedMatchKey}
        activeRun={activeRun}
        dailyFritzPackageForMatch={dailyFritzPackageForMatch}
        setOverlayConfig={setOverlayConfig}
        userId={user?.id ?? null}
        username={profile?.username ?? null}
        profile={profile}
        ghostProfile={ghostProfile}
        onGhostProfileChange={onGhostProfileChange}
        onProfileRefresh={onProfileRefresh}
        onProfilePatch={onProfilePatch}
        onBack={onBack}
        onEmbeddedBack={() => {
          closeEmbeddedRun();
          void loadToday();
        }}
        onDailyFritzGameComplete={(result) => {
          return handleDailyFritzGameComplete(result);
        }}
        onDailyFritzComplete={() => {
          void finishEmbeddedRun();
        }}
        socket={socket}
      />
    );
  }

  if (showInitScreen) {
    return (
      <DailyFritzLoadingScreen
        phase={initPhase as Exclude<typeof initPhase, 'ready'>}
        loadError={loadError}
        onBack={onBack}
        onRetry={() => {
          void runInit({ clearStale: true, isRetry: true });
        }}
        retryPending={initRetryPending}
      />
    );
  }

  return (
    <DailyFritzHubView
      hub={hubViewModel}
      heroSrc={heroSrc}
      hubError={hubError}
      startActionPending={startActionPending}
      onBack={onBack}
      onNavigate={onNavigate}
      onOpenAuth={onOpenAuth}
      onOpenAccount={onOpenAccount}
      onSetAction={handleSetAction}
      onOpenLeaderboard={openLeaderboard}
    />
  );
}

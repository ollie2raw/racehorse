import React, { Suspense } from 'react';
import { ScreenLoader } from './ui/ScreenLoader';
import { claudeRgb } from './ui/claudeModeUtils';
import type { AppRoutesProps } from './appRouteTypes';
import { JOURNEY_MODE_VISIBLE, LEARN_MODE_VISIBLE } from './appRouteTypes';
import {
  clearJourneyActiveChallenge,
  getJourneyActiveChallenge,
  setJourneyActiveChallenge,
} from './journey/journeyRuntime';
import { markJourneyNodeCompleted } from './journey/journeyStorage';
import { ErrorBoundary } from './components/ErrorBoundary';

const SinglePlayerHubScreen = React.lazy(() => import('./screens/SinglePlayerHubScreen'));
const RacehorseJourneyScreen = React.lazy(() => import('./journey/RacehorseJourneyScreen'));
const NoBrainerLabScreen = React.lazy(() => import('./practice/NoBrainerLabScreen'));
const BotMatchScreen = React.lazy(() => import('./bot/BotMatchScreen'));
const PlayVsFritz = React.lazy(() => import('./bot/PlayVsFritz'));
const GhostSetupScreen = React.lazy(() => import('./ghost/GhostSetupScreen'));
const DailyPuzzleScreen = React.lazy(() => import('./dailyPuzzle/DailyPuzzleScreen'));
const DailyFritzScreen = React.lazy(() => import('./dailyFritz/DailyFritzScreen'));
const RatingHistoryPage = React.lazy(() => import('./ranking/RatingHistoryPage'));
const StatsScreen = React.lazy(() => import('./stats/StatsScreen'));
const FriendsScreenLobbyBridge = React.lazy(() => import('./multiplayer/FriendsScreenLobbyBridge'));
const ActivityFeedLobbyBridge = React.lazy(() => import('./multiplayer/ActivityFeedLobbyBridge'));
const DailyFritzLeaderboardRoute = React.lazy(() => import('./dailyFritz/DailyFritzLeaderboardRoute'));
const PublicProfileScreenLobbyBridge = React.lazy(() => import('./multiplayer/PublicProfileScreenLobbyBridge'));
const RacehorseHomeScreen = React.lazy(() => import('./screens/HomeScreen'));
const MultiplayerModeController = React.lazy(() => import('./multiplayer/MultiplayerModeController'));
const TournamentHubScreen = React.lazy(() => import('./tournament/TournamentHubScreen'));
const TournamentBracketScreen = React.lazy(() => import('./tournament/TournamentBracketScreen'));
const TournamentResultScreen = React.lazy(() => import('./tournament/TournamentResultScreen'));
const LearnHome = React.lazy(() => import('./learn/LearnHome'));
const GuidedMatchRecorderScreen = React.lazy(() =>
  import('./learn/guidedMatch/GuidedMatchRecorderScreen'),
);
const GuidedMatchAnnotatorScreen = React.lazy(() =>
  import('./learn/guidedMatch/GuidedMatchAnnotatorScreen'),
);
const LearnHowToPlayRacehorse = React.lazy(() => import('./learn/LearnHowToPlayRacehorse'));
const LearnPlayer = React.lazy(() => import('./learn/LearnPlayer'));
const WeeklyStatsScreen = React.lazy(() => import('./stats/WeeklyStatsScreen'));

export default function AppRoutes({
  shell,
  navigation,
  auth,
  learn,
  botMatch,
  ghost,
  social,
  homeOverlays,
  multiplayer,
  tournament: tournamentProps,
}: AppRoutesProps) {
  const {
    withAuthModals,
    fallbackConnectionHost,
    appRootClassName,
    appRootRef,
    friendInvitePopup,
  } = shell;
  const { appMode, setAppMode } = navigation;
  const {
    handleOpenAuthModal,
    handleOpenAccountModal,
    isAdmin,
    authUser,
    authProfile,
    supabaseEnabled,
    supabaseConfigError,
    refreshAuthProfile,
    applyProfilePatch,
    setAuthModalOpen,
    setUsernameModalOpen,
    myHandle,
    homeRatingLabel,
  } = auth;
  const {
    showLearnAdminView,
    canOpenHowToPlayPreview,
    selectedLearnLessonId,
    setSelectedLearnLessonId,
    learnHowToPlayOpen,
    setLearnHowToPlayOpen,
    setIsGuidedMode,
    setIsAuthoringMode,
    setIsAuthoringV2Mode,
    setIsGuidedV2Mode,
  } = learn;
  const {
    setBotFritzTier,
    setBotDealSize,
    botDealSize,
    botFritzTier,
    isGuidedMode,
    isAuthoringMode,
    isAuthoringV2Mode,
    isGuidedV2Mode,
  } = botMatch;
  const {
    ghostProfile,
    setGhostProfile,
    ghostOpponentName,
    ghostOpponentUserId,
    setGhostOpponentName,
    setGhostOpponentUserId,
  } = ghost;
  const {
    socket,
    connect,
    joinedRoom,
    showToast,
    outboundChallenge,
    clearOutboundChallenge,
    profileTarget,
    setProfileTarget,
    profileOriginMode,
    setProfileOriginMode,
    toast,
  } = social;
  const {
    activeHomeMode,
    setActiveHomeMode,
    welcomeOpen,
    setWelcomeOpen,
    weeklyStatsOpen,
    setWeeklyStatsOpen,
  } = homeOverlays;
  const {
    error,
    actionError,
    state,
    setError,
    setActionError,
    multiplayerConnectionBundle,
    mpSubView,
    startGame,
    multiplayerModeViewProps,
  } = multiplayer;
  const {
    tournament,
    tournamentSubView,
    activeTournamentId,
    tournamentAttachPhase,
    tournamentAttachError,
    tournamentResult,
    tournamentResultLoading,
    tournamentResultError,
    setTournamentSubView,
    setActiveTournamentId,
    setTournamentResult,
    setTournamentResultLoading,
    setTournamentResultError,
    exitToTournamentHub,
    enterTournamentLobby,
    attachAssignedTournamentMatch,
  } = tournamentProps;

  if (typeof window !== 'undefined' && (window.location.pathname === '/redesign' || window.location.pathname === '/') && appMode === 'home') {
    return withAuthModals(
      <Suspense fallback={<ScreenLoader label="Loading Home…" />}>
        <RacehorseHomeScreen
          setAppMode={setAppMode}
          onOpenAuth={handleOpenAuthModal}
          onOpenAccount={handleOpenAccountModal}
        />
      </Suspense>,
    );
  }

  if (appMode === 'noBrainer') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading No Brainer Lab…" />}>
          <NoBrainerLabScreen
            userId={authUser?.id ?? null}
            onBack={() => setAppMode('singlePlayerHub')}
          />
        </Suspense>
      </div>,
    );
  }

  if (appMode === 'learn' && LEARN_MODE_VISIBLE) {
    if (selectedLearnLessonId) {
      return withAuthModals(
        <div className={appRootClassName}>
          <Suspense fallback={<ScreenLoader label="Loading Lesson…" />}>
            <LearnPlayer
              lessonId={selectedLearnLessonId}
              onExit={() => {
                setSelectedLearnLessonId(null);
              }}
            />
          </Suspense>
        </div>
      );
    }
    if (learnHowToPlayOpen && canOpenHowToPlayPreview) {
      return withAuthModals(
        <div className={appRootClassName}>
          <Suspense fallback={<ScreenLoader label="Loading Learn…" />}>
            <LearnHowToPlayRacehorse
              onBack={() => setLearnHowToPlayOpen(false)}
              onNavigate={setAppMode}
              onStartGuidedMatch={async () => {
                setLearnHowToPlayOpen(false);
                const { resolveGuidedMatchStart } = await import('./learn/lessonV2');
                const start = resolveGuidedMatchStart();
                if (!start.route) return;
                setIsGuidedMode(start.route === 'v1');
                setIsGuidedV2Mode(start.route === 'v2');
                setBotFritzTier('standard');
                setBotDealSize(7);
                setAppMode('bot');
              }}
            />
          </Suspense>
        </div>
      );
    }
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Learn Mode…" />}>
          <LearnHome
            onBack={() => setAppMode('home')}
            onNavigate={setAppMode}
            onOpenAuth={handleOpenAuthModal}
            onOpenAccount={handleOpenAccountModal}
            isAdmin={isAdmin}
            showAdminView={Boolean(isAdmin && showLearnAdminView)}
            canOpenHowToPlay={canOpenHowToPlayPreview}
            onOpenHowToPlay={
              canOpenHowToPlayPreview ? () => setLearnHowToPlayOpen(true) : undefined
            }
            onStartGuidedGame={() => {
              setIsGuidedMode(true);
              setBotFritzTier('standard');
              setBotDealSize(7);
              setAppMode('bot');
            }}
            onStartGuidedAuthoring={() => {
              setIsAuthoringMode(true);
              setBotFritzTier('elite');
              setBotDealSize(7);
              setAppMode('bot');
            }}
            onFreezeLesson={async () => {
              const { loadAuthoringSession, saveFrozenLesson } = await import('./learn/guidedAuthoring');
              const session = loadAuthoringSession();
              if (session) {
                saveFrozenLesson(session);
              }
            }}
            onStartGuidedV2Game={async () => {
              const { resolveGuidedMatchStart } = await import('./learn/lessonV2');
              const start = resolveGuidedMatchStart();
              if (!start.route) return;
              setIsGuidedMode(start.route === 'v1');
              setIsGuidedV2Mode(start.route === 'v2');
              setBotFritzTier('standard');
              setBotDealSize(7);
              setAppMode('bot');
            }}
            onStartAuthoringV2={() => {
              setIsAuthoringV2Mode(true);
              setBotFritzTier('elite');
              setBotDealSize(7);
              setAppMode('bot');
            }}
            onStartGuidedMatchRecorder={() => {
              setAppMode('guidedMatchRecorder');
            }}
            onOpenGuidedMatchAnnotator={() => {
              setAppMode('guidedMatchAnnotator');
            }}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'guidedMatchAnnotator') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Guided Match Annotator…" />}>
          <GuidedMatchAnnotatorScreen
            onBack={() => setAppMode('learn')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'guidedMatchRecorder') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Guided Match Recorder…" />}>
          <GuidedMatchRecorderScreen
            onBack={() => setAppMode('learn')}
            onNavigate={setAppMode}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'botSetup') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Fritz Setup…" />}>
          <PlayVsFritz
            onStart={({ difficulty, dealSize }) => {
              setBotFritzTier(difficulty);
              setBotDealSize(dealSize);
              setAppMode('bot');
            }}
            onBack={() => setAppMode('singlePlayerHub')}
            onNavigate={setAppMode}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenAccount={() => setUsernameModalOpen(true)}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'bot') {
    const journeyChallenge = getJourneyActiveChallenge();
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Fritz Match…" />}>
          <ErrorBoundary context="bot-match">
          <BotMatchScreen
            onBack={() => {
              if (journeyChallenge) {
                clearJourneyActiveChallenge();
                setAppMode('journey');
                return;
              }
              const shouldReturnHome =
                isGuidedMode || isAuthoringMode || isAuthoringV2Mode || isGuidedV2Mode;
              setIsGuidedMode(false);
              setIsAuthoringMode(false);
              setIsAuthoringV2Mode(false);
              setIsGuidedV2Mode(false);
              setAppMode(shouldReturnHome ? 'home' : 'singlePlayerHub');
            }}
            onNavigate={(mode) => {
              if (journeyChallenge) {
                clearJourneyActiveChallenge();
              }
              if (mode === 'learn') {
                setIsGuidedMode(false);
                setIsAuthoringMode(false);
                setIsAuthoringV2Mode(false);
                setIsGuidedV2Mode(false);
              }
              setAppMode(mode);
            }}
            dealSize={journeyChallenge?.dealSize ?? botDealSize}
            fritzTier={journeyChallenge?.fritzTier ?? botFritzTier}
            winningScore={journeyChallenge?.winningScore ?? 60}
            journeyTrial={
              journeyChallenge
                ? { nodeId: journeyChallenge.nodeId, nodeTitle: journeyChallenge.nodeTitle }
                : null
            }
            onJourneyTrialComplete={(result) => {
              if (result.won) {
                markJourneyNodeCompleted(result.nodeId);
              }
              clearJourneyActiveChallenge();
              setAppMode('journey');
            }}
            isGuidedMode={isGuidedMode}
            isAuthoringMode={isAuthoringMode}
            isAuthoringV2Mode={isAuthoringV2Mode}
            isGuidedV2Mode={isGuidedV2Mode}
            enableGuidedMatchCandidateCapture={
              Boolean(isAdmin) &&
              !journeyChallenge &&
              !isGuidedMode &&
              !isAuthoringMode &&
              !isAuthoringV2Mode &&
              !isGuidedV2Mode &&
              botFritzTier === 'standard' &&
              botDealSize === 7
            }
            userId={authUser?.id ?? null}
            username={authProfile?.username ?? null}
            currentGlickoRating={authProfile?.glicko_rating ?? null}
            currentGlickoRd={authProfile?.glicko_rd ?? null}
            currentGlickoVol={authProfile?.glicko_vol ?? null}
            rankedGamesPlayed={authProfile?.ranked_games_played ?? null}
            onProfileRefresh={refreshAuthProfile}
            onProfilePatch={applyProfilePatch}
          />
          </ErrorBoundary>
        </Suspense>
      </div>
    );
  }

  if (appMode === 'ghostSetup') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Ghost Setup…" />}>
          <GhostSetupScreen
            userId={authUser?.id ?? null}
            fritzGamesPlayed={authProfile?.ranked_games_played ?? 0}
            onBack={() => setAppMode('singlePlayerHub')}
            onNavigate={setAppMode}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenAccount={() => setUsernameModalOpen(true)}
            onStart={(summary, opponentName, opponentUserId) => {
              setGhostProfile(summary);
              setGhostOpponentName(opponentName);
              setGhostOpponentUserId(opponentUserId);
              setAppMode('ghost');
            }}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'ghost') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Ghost Match…" />}>
          <ErrorBoundary context="bot-match">
          <BotMatchScreen
            onBack={() => setAppMode('singlePlayerHub')}
            onNavigate={setAppMode}
            dealSize={botDealSize}
            mode="ghost"
            userId={authUser?.id ?? null}
            username={authProfile?.username ?? null}
            opponentName={ghostOpponentName}
            opponentUserId={ghostOpponentUserId}
            currentGlickoRating={authProfile?.glicko_rating ?? null}
            ghostProfile={ghostProfile}
            onGhostProfileChange={setGhostProfile}
            onProfileRefresh={refreshAuthProfile}
            onProfilePatch={applyProfilePatch}
          />
          </ErrorBoundary>
        </Suspense>
      </div>
    );
  }

  if (appMode === 'daily') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Daily Puzzle…" />}>
          <ErrorBoundary context="daily-puzzle">
          <DailyPuzzleScreen
            user={authUser}
            profile={authProfile}
            onBack={() => setAppMode('home')}
            onNavigate={setAppMode}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenAccount={() => setUsernameModalOpen(true)}
          />
          </ErrorBoundary>
        </Suspense>
      </div>
    );
  }

  if (appMode === 'dailyFritz') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Daily Fritz…" />}>
          <DailyFritzScreen
            user={authUser}
            profile={authProfile}
            ghostProfile={ghostProfile}
            onGhostProfileChange={setGhostProfile}
            onProfileRefresh={refreshAuthProfile}
            onProfilePatch={applyProfilePatch}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenAccount={() => setUsernameModalOpen(true)}
            onBack={() => setAppMode('home')}
            onNavigate={setAppMode}
          />

        </Suspense>
      </div>
    );
  }

  if (appMode === 'ratingHistory') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Rating History…" />}>
          <RatingHistoryPage
            userId={authUser?.id ?? null}
            username={authProfile?.username ?? null}
            onBack={() => setAppMode('home')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'friends') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Friends…" />}>
          <FriendsScreenLobbyBridge
            open={true}
            user={authUser}
            socket={socket}
            joinedRoom={joinedRoom}
            currentUsername={authProfile?.username ?? ''}
            showToast={showToast}
            onClose={() => setAppMode('home')}
            onViewProfile={(username) => {
              setProfileTarget(username);
              setProfileOriginMode('friends');
              setAppMode('profile');
            }}
          />
        </Suspense>
        {friendInvitePopup}
      </div>
    );
  }

  if (appMode === 'stats') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Stats…" />}>
          <StatsScreen
            open={true}
            user={authUser}
            profile={authProfile}
            onClose={() => setAppMode('home')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'feed') {
    return withAuthModals(
      <div className={appRootClassName}>
        {toast && <div className="toast">{toast}</div>}
        <Suspense fallback={<ScreenLoader label="Loading Feed…" />}>
          <ActivityFeedLobbyBridge
            user={authUser}
            socket={socket}
            connect={connect}
            showToast={showToast}
            outboundChallenge={outboundChallenge}
            clearOutboundChallenge={clearOutboundChallenge}
            onViewProfile={(username) => {
              setProfileTarget(username);
              setProfileOriginMode('feed');
              setAppMode('profile');
            }}
            onClose={() => setAppMode('home')}
            onNavigateToFriends={() => setAppMode('friends')}
            onNavigate={setAppMode}
            onOpenAuth={handleOpenAuthModal}
            onOpenAccount={handleOpenAccountModal}
          />
        </Suspense>
        {friendInvitePopup}
      </div>
    );
  }

  if (appMode === 'leaderboard') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Leaderboard…" />}>
          <DailyFritzLeaderboardRoute
            user={authUser}
            profile={authProfile}
            onClose={() => setAppMode('home')}
            onNavigate={setAppMode}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenAccount={() => setUsernameModalOpen(true)}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'profile') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Profile…" />}>
          <PublicProfileScreenLobbyBridge
            username={profileTarget ?? ''}
            user={authUser}
            showToast={showToast}
            onClose={() => {
              setProfileTarget(null);
              const nextMode = profileOriginMode ?? 'home';
              setProfileOriginMode(null);
              setAppMode(nextMode);
            }}
            onChallenge={() => setAppMode('multiplayer')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'singlePlayerHub') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Single Player…" />}>
          <SinglePlayerHubScreen
            userId={authUser?.id ?? null}
            onBack={() => setAppMode('home')}
            onNavigate={setAppMode}
            onOpenAuth={handleOpenAuthModal}
            onOpenAccount={handleOpenAccountModal}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'journey' && JOURNEY_MODE_VISIBLE) {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Journey…" />}>
          <ErrorBoundary context="journey">
          <RacehorseJourneyScreen
            onBack={() => setAppMode('singlePlayerHub')}
            onNavigate={setAppMode}
            onOpenAuth={handleOpenAuthModal}
            onOpenAccount={handleOpenAccountModal}
            onStartBotTrial={(challenge) => {
              setJourneyActiveChallenge(challenge);
              setBotFritzTier(challenge.fritzTier);
              setBotDealSize(challenge.dealSize);
              setAppMode('bot');
            }}
          />
          </ErrorBoundary>
        </Suspense>
      </div>
    );
  }

  if (appMode === 'tournament') {
    const tIdentity = authUser?.id
      ? { userId: authUser.id, username: authProfile?.username ?? authUser.email?.split('@')[0] ?? 'player' }
      : null;

    if (tournamentSubView === 'bracket' && activeTournamentId) {
      return withAuthModals(
        <Suspense fallback={<ScreenLoader label="Loading Tournament Bracket…" />}>
          <ErrorBoundary context="tournament">
          <TournamentBracketScreen
            identity={tIdentity}
            tournamentId={activeTournamentId}
            bracket={tournament.activeBracket}
            tournamentPhase={tournament.tournamentPhase}
            assignedMatch={
              tournament.assignedMatch?.tournamentId === activeTournamentId
                ? tournament.assignedMatch
                : null
            }
            countdownAt={tournament.countdown?.at ?? null}
            countdownKind={tournament.countdown?.kind ?? null}
            onLoadBracket={(id) => { void tournament.openBracket(id); }}
            onBack={() => exitToTournamentHub('bracket_back')}
            onExitToHub={() => exitToTournamentHub('bracket_back')}
            onWithdraw={(id) => {
              void tournament.withdraw(id).then(() => exitToTournamentHub('withdraw'));
            }}
            onViewResult={() => {
              if (!activeTournamentId) return;
              setTournamentSubView('result');
              void tournament.openBracket(activeTournamentId);
            }}
            onNavigate={setAppMode}
            onOpenAuth={handleOpenAuthModal}
            onOpenAccount={handleOpenAccountModal}
            onAttachAssignedMatch={attachAssignedTournamentMatch}
            attachJoinPhase={tournamentAttachPhase}
            attachJoinError={tournamentAttachError}
          />
          </ErrorBoundary>
        </Suspense>,
      );
    }

    if (tournamentSubView === 'result' && activeTournamentId) {
      const myUserId = authUser?.id ?? null;
      const yourPlacement =
        (myUserId
          ? tournamentResult?.placements.find((placement) => placement.userId === myUserId)?.placementLabel
          : null) ?? null;

      const nextSlot = tournament.upcoming[0];
      const nextCountdown = nextSlot
        ? (() => {
            const ms = Math.max(0, Date.parse(nextSlot.scheduled_start) - Date.now());
            const total = Math.floor(ms / 1000);
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const s = total % 60;
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${pad(h)}:${pad(m)}:${pad(s)}`;
          })()
        : '—';

      return withAuthModals(
        <Suspense fallback={<ScreenLoader label="Loading Tournament Result…" />}>
          <ErrorBoundary context="tournament">
          <TournamentResultScreen
            isLoading={tournamentResultLoading}
            error={tournamentResultError}
            championName={tournamentResult?.championName ?? null}
            yourPlacement={yourPlacement}
            nextTournamentCountdown={nextCountdown}
            onRetry={() => {
              if (activeTournamentId) {
                setTournamentResultLoading(true);
                void import('./tournament/tournamentApi')
                  .then(({ fetchResult }) => fetchResult(activeTournamentId))
                  .then((result) => {
                    setTournamentResult(result);
                    setTournamentResultError(null);
                  })
                  .catch((err) => {
                    setTournamentResultError(err instanceof Error ? err.message : 'Failed to load tournament result');
                  })
                  .finally(() => setTournamentResultLoading(false));
              }
            }}
            onNextTournament={() => {
              setTournamentSubView('hub');
              setActiveTournamentId(null);
              setTournamentResult(null);
            }}
          />
          </ErrorBoundary>
        </Suspense>,
      );
    }

    return withAuthModals(
      <Suspense fallback={<ScreenLoader label="Loading Tournament Hub…" />}>
        <ErrorBoundary context="tournament">
        <TournamentHubScreen
          identity={tIdentity}
          upcoming={tournament.upcoming}
          registrations={tournament.registrations}
          recoveryMatch={tournament.recoveryMatch}
          tournamentPhase={tournament.tournamentPhase}
          error={tournament.error}
          isLoading={tournament.isLoading}
          hasLoaded={tournament.hasLoaded}
          activeBracketStatus={tournament.activeBracket?.tournament.status ?? null}
          activeTournamentId={tournament.activeTournamentId}
          onNavigate={setAppMode}
          onOpenAuth={handleOpenAuthModal}
          onOpenAccount={handleOpenAccountModal}
          onBackHome={() => setAppMode('home')}
          onOpenBracket={(id) => enterTournamentLobby(id)}
          onRegister={async (id) => {
            await tournament.register(id);
            enterTournamentLobby(id);
          }}
          onWithdraw={async (id) => {
            await tournament.withdraw(id);
            if (activeTournamentId === id) exitToTournamentHub('withdraw');
          }}
          onRetry={() => {
            void tournament.refresh();
          }}
          onAttachAssignedMatch={attachAssignedTournamentMatch}
          attachJoinPhase={tournamentAttachPhase}
          attachJoinError={tournamentAttachError}
        />
        </ErrorBoundary>
      </Suspense>,
    );
  }

  if (appMode === 'multiplayer') {
    return withAuthModals(
      <div ref={appRootRef} className={appRootClassName}>
        {toast && <div className="toast">{toast}</div>}
        {friendInvitePopup}

        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError('')}>×</button>
          </div>
        )}

        {actionError && state && !state.handOver && !state.gameOver && (
          <div className="error-banner">
            {actionError}
            <button onClick={() => setActionError('')}>×</button>
          </div>
        )}

        <Suspense fallback={<ScreenLoader label="Loading Multiplayer…" />}>
          <ErrorBoundary context="multiplayer">
          <MultiplayerModeController
            connection={multiplayerConnectionBundle}
            mpSubView={mpSubView}
            startGame={startGame}
            view={multiplayerModeViewProps}
          />
          </ErrorBoundary>
        </Suspense>
      </div>,
    );
  }

  const dismissWelcome = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('hasSeenWelcome', 'true');
    }
    setWelcomeOpen(false);
  };
  const welcomeModal =
    appMode === 'home' && welcomeOpen ? (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to Racehorse Dominoes"
        onClick={dismissWelcome}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1600,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
          display: 'grid',
          placeItems: 'center',
          padding: 12,
        }}
      >
        <div
          className="card welcome-modal-card"
          onClick={(e) => e.stopPropagation()}
          style={{ textAlign: 'left' }}
        >
          <h3 className="welcome-modal-title" style={{ margin: 0, lineHeight: 1.2 }}>
            How to Play
          </h3>
          <p className="welcome-modal-subtitle">
            Quick guide to each game mode.
          </p>
          <div className="welcome-mode-list">
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#38bdf8' }} aria-hidden="true" />
                Multiplayer Online
              </div>
              <div className="welcome-mode-desc">Play live 1v1 against a friend with a room code</div>
            </div>
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#e05c6a' }} aria-hidden="true" />
                Tournament Mode
              </div>
              <div className="welcome-mode-desc">Round robin (4+ players), matches to 30, play everyone once</div>
            </div>
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#f59e0b' }} aria-hidden="true" />
                Daily Puzzle
              </div>
              <div className="welcome-mode-desc">One puzzle per day, compete on the leaderboard</div>
            </div>
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#60a5fa' }} aria-hidden="true" />
                vs Bot
              </div>
              <div className="welcome-mode-desc">Practice against an AI opponent</div>
            </div>
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#a78bfa' }} aria-hidden="true" />
                No Brainer Lab
              </div>
              <div className="welcome-mode-desc">Practice clearing all 7 tiles in one turn</div>
            </div>
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#34d399' }} aria-hidden="true" />
                Stats &amp; Leaderboard
              </div>
              <div className="welcome-mode-desc">Track your wins, streaks, and weekly rank</div>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex' }}>
            <button
              className="mode-inline-btn welcome-cta"
              onClick={dismissWelcome}
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    ) : null;

  if (appMode === 'home') {
    return withAuthModals(
      <div ref={appRootRef} className={appRootClassName}>
        <div className="layout-screen screen lobby-screen mode-home-screen mode-accent-multiplayer home-lobby-screen claude-home-shell claude-home-screen-shell">
          <div className="layout-screen-bg" aria-hidden="true" />
          <div className="layout-screen-beam" aria-hidden="true" />
          <div className="layout-screen-vignette" aria-hidden="true" />
          <div className="layout-screen-inner home-lobby-shell">
            <div className="claude-accordion-home">
              <div className="claude-accordion-home__topbar">
                <div className="claude-accordion-home__brand">RACEHORSE</div>
                <div className="claude-accordion-home__utilities">
                  {authUser ? (
                    <button className="claude-accordion-home__utility" onClick={() => setUsernameModalOpen(true)}>
                      {myHandle} · {homeRatingLabel}
                    </button>
                  ) : (
                    <button className="claude-accordion-home__utility" onClick={() => setAuthModalOpen(true)}>
                      Sign In · Profile
                    </button>
                  )}
                  <button className="claude-accordion-home__utility is-secondary" onClick={() => setAppMode('friends')}>
                    Friends
                  </button>
                  <button className="claude-accordion-home__utility is-secondary" onClick={() => setAppMode('stats')}>
                    Stats
                  </button>
                </div>
              </div>
              <div className="claude-accordion-home__body">
                {[
                  { id: 'multiplayer', short: 'MULTI', label: 'Multiplayer Online', desc: 'Create a private room and play head to head in real time', accent: '#38bdf8', live: true, action: () => setAppMode('multiplayer') },
                  { id: 'singlePlayerHub', short: 'SOLO', label: 'Single Player Modes', desc: 'Play vs Fritz, Ghost Mode & No Brainer Lab', accent: '#a78bfa', action: () => setAppMode('singlePlayerHub') },
                  { id: 'dailyFritz', short: 'FRITZ', label: 'Daily Fritz Set', desc: 'One fixed best of 3 Fritz set per day. Same deals for everyone.', accent: '#e05c6a', action: () => setAppMode('dailyFritz') },
                  { id: 'daily', short: 'PUZZLE', label: 'Daily Puzzle', desc: 'Solve today’s featured scenario and compare leaderboard results', accent: '#f0c040', action: () => setAppMode('daily') },
                  { id: 'tournament', short: 'TOURN', label: 'Tournament Mode', desc: 'Round robin (4+ players), matches to 30, play everyone once', accent: '#fb923c', action: () => { setError(''); setAppMode('tournament'); } },
                  { id: 'learn', short: 'LEARN', label: 'Learn Academy', desc: 'New to dominoes? Learn how to play and win.', accent: '#34d399', action: () => setAppMode('learn') },
                ].map((mode, index, all) => {
                  const isActive = activeHomeMode === mode.id;
                  const hasActive = activeHomeMode !== null;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      className={`claude-accordion-home__panel${isActive ? ' is-active' : ''}${hasActive ? ' has-active' : ''}`}
                      style={{ ['--panel-accent' as string]: mode.accent, ['--panel-accent-rgb' as string]: claudeRgb(mode.accent), borderRight: index < all.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
                      onMouseEnter={() => setActiveHomeMode(mode.id as typeof activeHomeMode)}
                      onFocus={() => setActiveHomeMode(mode.id as typeof activeHomeMode)}
                      onClick={mode.action}
                    >
                      <div className="claude-accordion-home__panel-atmo" />
                      <div className="claude-accordion-home__big-number">{index + 1}</div>
                      {mode.live ? <div className="claude-accordion-home__live">LIVE</div> : null}
                      <div className="claude-accordion-home__panel-content">
                        <div className="claude-accordion-home__mode-number">MODE {String(index + 1).padStart(2, '0')}</div>
                        <div className="claude-accordion-home__mode-title">{mode.label}</div>
                        <div className="claude-accordion-home__mode-desc">{mode.desc}</div>
                        <div className="claude-accordion-home__enter">Enter</div>
                      </div>
                      <div className="claude-accordion-home__collapsed">
                        <div className="claude-accordion-home__collapsed-label">{mode.short}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {!supabaseEnabled && (
              <p className="lobby-server mode-subtitle" style={{ marginTop: 12 }}>
                {supabaseConfigError ?? 'Supabase not configured.'}
              </p>
            )}
          </div>
        </div>
        {welcomeModal}
        {weeklyStatsOpen ? (
          <Suspense fallback={null}>
            <WeeklyStatsScreen
              open={weeklyStatsOpen}
              onClose={() => setWeeklyStatsOpen(false)}
              user={authUser}
            />
          </Suspense>
        ) : null}
        {friendInvitePopup}
</div>,
    );
  }


  return fallbackConnectionHost;
}

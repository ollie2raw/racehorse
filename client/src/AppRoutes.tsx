import React, { Suspense } from 'react';
import { ScreenLoader } from './ui/ScreenLoader';
import type { AppRoutesProps } from './appRouteTypes';
import { JOURNEY_MODE_VISIBLE, LEARN_MODE_VISIBLE } from './appRouteTypes';
import {
  clearJourneyActiveChallenge,
  getJourneyActiveChallenge,
  setJourneyActiveChallenge,
} from './journey/journeyRuntime';
import { markJourneyNodeCompleted } from './journey/journeyStorage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isSpectatorModeEnabled, resolveSpectatorGatedMode } from './config/spectatorModeFeature';

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
const LeaderboardScreen = React.lazy(() => import('./social/LeaderboardScreen'));
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
const spectatorModeEnabled = isSpectatorModeEnabled();
const LiveNowScreen = spectatorModeEnabled ? React.lazy(() => import('./live/LiveNowScreen')) : null;

export default function AppRoutes({
  shell,
  navigation,
  auth,
  learn,
  botMatch,
  ghost,
  social,
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
  React.useEffect(() => {
    const resolved = resolveSpectatorGatedMode(appMode, spectatorModeEnabled);
    if (resolved !== appMode) setAppMode(resolved);
  }, [appMode, setAppMode]);
  const {
    handleOpenAuthModal,
    handleOpenAccountModal,
    isAdmin,
    authUser,
    authProfile,
    refreshAuthProfile,
    applyProfilePatch,
    setAuthModalOpen,
    setUsernameModalOpen,
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

  if (appMode === 'home' || (appMode === 'live' && !spectatorModeEnabled)) {
    return withAuthModals(
      <Suspense fallback={<ScreenLoader label="Loading Home…" />}>
        <RacehorseHomeScreen
          setAppMode={setAppMode}
          onOpenAuth={handleOpenAuthModal}
          onOpenAccount={handleOpenAccountModal}
          tournament={tournamentProps.tournament}
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
            onBack={() => setAppMode('learn')}
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
            key="daily-hub"
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

  if (appMode === 'dailyPuzzleLeaderboard') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Daily Puzzle Leaderboard…" />}>
          <ErrorBoundary context="daily-puzzle-leaderboard">
          <DailyPuzzleScreen
            key="daily-leaderboard"
            user={authUser}
            profile={authProfile}
            initialView="leaderboard"
            onLeaderboardClose={() => setAppMode('daily')}
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
            socket={socket}
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

  if (appMode === 'dailyFritzLeaderboard') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Daily Fritz Leaderboard…" />}>
          <DailyFritzLeaderboardRoute
            user={authUser}
            profile={authProfile}
            onClose={() => setAppMode('dailyFritz')}
            onNavigate={setAppMode}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenAccount={() => setUsernameModalOpen(true)}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'live' && spectatorModeEnabled && LiveNowScreen) {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Live Now…" />}>
          <LiveNowScreen socket={socket} connect={social.connect} onBack={() => setAppMode('home')} />
        </Suspense>
      </div>,
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
          <LeaderboardScreen
            user={authUser}
            onViewProfile={(username) => {
              setProfileTarget(username);
              setProfileOriginMode('leaderboard');
              setAppMode('profile');
            }}
            onClose={() => setAppMode('feed')}
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

  return fallbackConnectionHost;
}

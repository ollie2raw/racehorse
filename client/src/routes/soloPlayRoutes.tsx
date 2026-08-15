import React, { Suspense } from 'react';
import { ScreenLoader } from '../ui/ScreenLoader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import type {
  AppRoutesShellProps,
  AppRoutesNavigationProps,
  AppRoutesAuthProps,
  AppRoutesLearnProps,
  AppRoutesBotMatchProps,
  AppRoutesGhostProps,
  AppRoutesTournamentProps,
} from '../appRouteTypes';
import {
  clearJourneyActiveChallenge,
  getJourneyActiveChallenge,
  setJourneyActiveChallenge,
} from '../journey/journeyRuntime';
import { markJourneyNodeCompleted } from '../journey/journeyStorage';

const SinglePlayerHubScreen = React.lazy(() => import('../screens/SinglePlayerHubScreen'));
const RacehorseJourneyScreen = React.lazy(() => import('../journey/RacehorseJourneyScreen'));
const NoBrainerLabScreen = React.lazy(() => import('../practice/NoBrainerLabScreen'));
const BotMatchScreen = React.lazy(() => import('../bot/BotMatchScreen'));
const PlayVsFritz = React.lazy(() => import('../bot/PlayVsFritz'));
const GhostSetupScreen = React.lazy(() => import('../ghost/GhostSetupScreen'));
const RacehorseHomeScreen = React.lazy(() => import('../screens/HomeScreen'));
const LearnHome = React.lazy(() => import('../learn/LearnHome'));
const GuidedMatchRecorderScreen = React.lazy(() =>
  import('../learn/guidedMatch/GuidedMatchRecorderScreen'),
);
const GuidedMatchAnnotatorScreen = React.lazy(() =>
  import('../learn/guidedMatch/GuidedMatchAnnotatorScreen'),
);
const LearnHowToPlayRacehorse = React.lazy(() => import('../learn/LearnHowToPlayRacehorse'));
const LearnPlayer = React.lazy(() => import('../learn/LearnPlayer'));

export function HomeRoute({
  shell,
  navigation,
  auth,
  tournament: tournamentProps,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
  tournament: AppRoutesTournamentProps;
}) {
  const { withAuthModals } = shell;
  const { setAppMode } = navigation;
  const { handleOpenAuthModal, handleOpenAccountModal } = auth;
  return withAuthModals(
    <ErrorBoundary context="home">
      <Suspense fallback={<ScreenLoader label="Loading Home…" />}>
        <RacehorseHomeScreen
          setAppMode={setAppMode}
          onOpenAuth={handleOpenAuthModal}
          onOpenAccount={handleOpenAccountModal}
          tournament={tournamentProps.tournament}
        />
      </Suspense>
    </ErrorBoundary>,
  );
}

export function NoBrainerRoute({
  shell,
  navigation,
  auth,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  const { authUser } = auth;
  return withAuthModals(
    <div className={appRootClassName}>
      <ErrorBoundary context="no-brainer">
        <Suspense fallback={<ScreenLoader label="Loading No Brainer Lab…" />}>
          <NoBrainerLabScreen
            userId={authUser?.id ?? null}
            onBack={() => setAppMode('learn')}
          />
        </Suspense>
      </ErrorBoundary>
    </div>,
  );
}

export function LearnRoute({
  shell,
  navigation,
  auth,
  learn,
  botMatch,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
  learn: AppRoutesLearnProps;
  botMatch: AppRoutesBotMatchProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  const { handleOpenAuthModal, handleOpenAccountModal, isAdmin } = auth;
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
  const { setBotFritzTier, setBotDealSize } = botMatch;

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
        <ErrorBoundary context="learn-how-to-play">
        <Suspense fallback={<ScreenLoader label="Loading Learn…" />}>
          <LearnHowToPlayRacehorse
            onBack={() => setLearnHowToPlayOpen(false)}
            onNavigate={setAppMode}
            onStartGuidedMatch={async () => {
              setLearnHowToPlayOpen(false);
              const { resolveGuidedMatchStart } = await import('../learn/lessonV2');
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
        </ErrorBoundary>
      </div>
    );
  }
  return withAuthModals(
    <div className={appRootClassName}>
      <ErrorBoundary context="learn">
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
            const { loadAuthoringSession, saveFrozenLesson } = await import('../learn/guidedAuthoring');
            const session = loadAuthoringSession();
            if (session) {
              saveFrozenLesson(session);
            }
          }}
          onStartGuidedV2Game={async () => {
            const { resolveGuidedMatchStart } = await import('../learn/lessonV2');
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
      </ErrorBoundary>
    </div>
  );
}

export function GuidedMatchAnnotatorRoute({
  shell,
  navigation,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  return withAuthModals(
    <div className={appRootClassName}>
      <ErrorBoundary context="guided-match-annotator">
      <Suspense fallback={<ScreenLoader label="Loading Guided Match Annotator…" />}>
        <GuidedMatchAnnotatorScreen
          onBack={() => setAppMode('learn')}
        />
      </Suspense>
      </ErrorBoundary>
    </div>
  );
}

export function GuidedMatchRecorderRoute({
  shell,
  navigation,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  return withAuthModals(
    <div className={appRootClassName}>
      <ErrorBoundary context="guided-match-recorder">
      <Suspense fallback={<ScreenLoader label="Loading Guided Match Recorder…" />}>
        <GuidedMatchRecorderScreen
          onBack={() => setAppMode('learn')}
          onNavigate={setAppMode}
        />
      </Suspense>
      </ErrorBoundary>
    </div>
  );
}

export function BotSetupRoute({
  shell,
  navigation,
  auth,
  botMatch,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
  botMatch: AppRoutesBotMatchProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  const { setAuthModalOpen, setUsernameModalOpen } = auth;
  const { setBotFritzTier, setBotDealSize } = botMatch;
  return withAuthModals(
    <div className={appRootClassName}>
      <ErrorBoundary context="bot-setup">
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
      </ErrorBoundary>
    </div>
  );
}

export function BotMatchRoute({
  shell,
  navigation,
  auth,
  learn,
  botMatch,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
  learn: AppRoutesLearnProps;
  botMatch: AppRoutesBotMatchProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  const { isAdmin, authUser, authProfile, refreshAuthProfile, applyProfilePatch } = auth;
  const { setIsGuidedMode, setIsAuthoringMode, setIsAuthoringV2Mode, setIsGuidedV2Mode } = learn;
  const {
    botDealSize,
    botFritzTier,
    isGuidedMode,
    isAuthoringMode,
    isAuthoringV2Mode,
    isGuidedV2Mode,
  } = botMatch;
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

export function GhostSetupRoute({
  shell,
  navigation,
  auth,
  ghost,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
  ghost: AppRoutesGhostProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  const { authUser, authProfile, setAuthModalOpen, setUsernameModalOpen } = auth;
  const { setGhostProfile, setGhostOpponentName, setGhostOpponentUserId } = ghost;
  return withAuthModals(
    <div className={appRootClassName}>
      <ErrorBoundary context="ghost-setup">
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
      </ErrorBoundary>
    </div>
  );
}

export function GhostMatchRoute({
  shell,
  navigation,
  auth,
  ghost,
  botMatch,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
  ghost: AppRoutesGhostProps;
  botMatch: AppRoutesBotMatchProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  const { authUser, authProfile, refreshAuthProfile, applyProfilePatch } = auth;
  const { ghostProfile, setGhostProfile, ghostOpponentName, ghostOpponentUserId } = ghost;
  const { botDealSize } = botMatch;
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

export function SinglePlayerHubRoute({
  shell,
  navigation,
  auth,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  const { authUser, handleOpenAuthModal, handleOpenAccountModal } = auth;
  return withAuthModals(
    <div className={appRootClassName}>
      <ErrorBoundary context="single-player-hub">
      <Suspense fallback={<ScreenLoader label="Loading Single Player…" />}>
        <SinglePlayerHubScreen
          userId={authUser?.id ?? null}
          onBack={() => setAppMode('home')}
          onNavigate={setAppMode}
          onOpenAuth={handleOpenAuthModal}
          onOpenAccount={handleOpenAccountModal}
        />
      </Suspense>
      </ErrorBoundary>
    </div>
  );
}

export function JourneyRoute({
  shell,
  navigation,
  auth,
  botMatch,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
  botMatch: AppRoutesBotMatchProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  const { handleOpenAuthModal, handleOpenAccountModal } = auth;
  const { setBotFritzTier, setBotDealSize } = botMatch;
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

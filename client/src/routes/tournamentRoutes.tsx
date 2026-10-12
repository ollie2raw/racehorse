import React, { Suspense } from 'react';
import { ScreenLoader } from '../ui/ScreenLoader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { tournamentErrorCopy } from '../tournament/tournamentErrorCopy';
import { isTournamentsEnabled } from '../config/tournamentsFeature';
import { deriveResultView } from '../tournament/tournamentResultView';
import type {
  AppRoutesShellProps,
  AppRoutesNavigationProps,
  AppRoutesAuthProps,
  AppRoutesTournamentProps,
} from '../appRouteTypes';
import { publicPlayerName } from '../identity/publicPlayerName';

const TournamentHubScreen = React.lazy(() => import('../tournament/TournamentHubScreen'));
const TournamentBracketScreen = React.lazy(() => import('../tournament/TournamentBracketScreen'));
const TournamentResultScreen = React.lazy(() => import('../tournament/TournamentResultScreen'));
const TournamentHistoryRoute = React.lazy(() => import('../tournament/TournamentHistoryRoute'));

const EMPTY_IDS: ReadonlySet<string> = new Set();
const IDLE_FRITZ_LAUNCH = { phase: 'idle' as const, tournamentId: null, startedAtMono: 0, error: null };

export function TournamentRoute({
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
  const { handleOpenAuthModal, handleSignOut, authUser, authProfile } = auth;
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

  // Switched off: every tournament route and deep link lands on the hub with
  // nothing scheduled ("Tournaments are unavailable right now"). No fetch, no socket.
  if (!isTournamentsEnabled()) {
    const noop = () => undefined;
    const noopAsync = async () => undefined;
    return withAuthModals(
      <Suspense fallback={<ScreenLoader label="Loading Tournament Hub…" />}>
        <TournamentHubScreen
          identity={null}
          features={{ tournaments: false, fritzCup: false }}
          upcoming={[]}
          myTournaments={[]}
          activeAssignedMatch={null}
          cancelledTournamentIds={EMPTY_IDS}
          fritzLaunch={IDLE_FRITZ_LAUNCH}
          upcomingError={null}
          myError={null}
          isLoading={false}
          hasLoaded
          onNavigate={setAppMode}
          onOpenAuth={handleOpenAuthModal}
          onSignOut={handleSignOut}
          onBackHome={() => setAppMode('home')}
          onPlayFritzCup={noop}
          onJoinMatch={noop}
          onViewBracket={noop}
          onViewResult={noop}
          onRegister={noopAsync}
          onWithdraw={noopAsync}
          onRetry={noop}
          onBoundary={noop}
        />
      </Suspense>,
    );
  }

  const tIdentity = authUser?.id
    ? { userId: authUser.id, username: publicPlayerName(authProfile?.username) }
    : null;

  if (tournamentSubView === 'bracket' && activeTournamentId) {
    return withAuthModals(
      <Suspense fallback={<ScreenLoader label="Loading Tournament Bracket…" />}>
        <ErrorBoundary context="tournament">
        <TournamentBracketScreen
          identity={tIdentity}
          tournamentId={activeTournamentId}
          bracket={tournament.activeBracket}
          bracketError={tournament.bracketError}
          tournamentPhase={tournament.tournamentPhase}
          assignedMatch={
            tournament.assignedMatch?.tournamentId === activeTournamentId
              ? tournament.assignedMatch
              : null
          }
          countdownAt={tournament.countdown?.at ?? null}
          countdownKind={tournament.countdown?.kind ?? null}
          onLoadBracket={tournament.openBracket}
          onBack={() => exitToTournamentHub('bracket_back')}
          onExitToHub={() => exitToTournamentHub('bracket_back')}
          onWithdraw={(id) => {
            // A refusal (withdraw_closed) keeps the player on the bracket; the hub shows the copy.
            void tournament.withdraw(id).then(() => exitToTournamentHub('withdraw')).catch(() => undefined);
          }}
          onViewResult={() => {
            if (!activeTournamentId) return;
            setTournamentSubView('result');
            void tournament.openBracket(activeTournamentId);
          }}
          onNavigate={setAppMode}
          onOpenAuth={handleOpenAuthModal}
          onSignOut={handleSignOut}
          onAttachAssignedMatch={attachAssignedTournamentMatch}
          attachJoinPhase={tournamentAttachPhase}
          attachJoinError={tournamentAttachError}
        />
        </ErrorBoundary>
      </Suspense>,
    );
  }

  if (tournamentSubView === 'history') {
    return withAuthModals(
      <Suspense fallback={<ScreenLoader label="Loading Tournament History…" />}>
        <ErrorBoundary context="tournament">
          <TournamentHistoryRoute
            fritzCupEnabled={Boolean(tournament.features?.fritzCup)}
            onBack={() => setTournamentSubView('hub')}
            onNavigate={setAppMode}
            onOpenAuth={handleOpenAuthModal}
            onSignOut={handleSignOut}
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

    const resultView = deriveResultView({
      tournamentId: activeTournamentId,
      result: tournamentResult,
      myTournaments: tournament.myTournaments,
      upcoming: tournament.upcoming,
      activeAssignedMatch: tournament.activeAssignedMatch,
    });

    return withAuthModals(
      <Suspense fallback={<ScreenLoader label="Loading Tournament Result…" />}>
        <ErrorBoundary context="tournament">
        <TournamentResultScreen
          isLoading={tournamentResultLoading}
          error={tournamentResultError}
          champion={resultView.champion}
          yourPlacement={yourPlacement}
          myOutcome={resultView.myOutcome}
          nextEventStart={resultView.nextEventStart}
          nextMatch={resultView.nextMatch}
          joining={tournamentAttachPhase === 'pending'}
          onJoinNextMatch={attachAssignedTournamentMatch}
          onRetry={() => {
            if (activeTournamentId) {
              setTournamentResultLoading(true);
              void import('../tournament/tournamentApi')
                .then(({ fetchResult }) => fetchResult(activeTournamentId))
                .then((result) => {
                  setTournamentResult(result);
                  setTournamentResultError(null);
                })
                .catch((err) => {
                  setTournamentResultError(tournamentErrorCopy(err instanceof Error ? err.message : null));
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
        features={tournament.features}
        upcoming={tournament.upcoming}
        myTournaments={tournament.myTournaments}
        activeAssignedMatch={tournament.activeAssignedMatch}
        cancelledTournamentIds={tournament.cancelledTournamentIds}
        fritzLaunch={tournament.fritzLaunch}
        upcomingError={tournament.upcomingError}
        myError={tournament.myError}
        isLoading={tournament.isLoading}
        hasLoaded={tournament.hasLoaded}
        attachJoinPhase={tournamentAttachPhase}
        attachJoinError={tournamentAttachError}
        onNavigate={setAppMode}
        onOpenAuth={handleOpenAuthModal}
        onSignOut={handleSignOut}
        onBackHome={() => setAppMode('home')}
        onOpenHistory={() => setTournamentSubView('history')}
        onPlayFritzCup={() => { void tournament.startFritzCup(); }}
        onJoinMatch={attachAssignedTournamentMatch}
        onViewBracket={(id) => {
          tournament.endFritzLaunch();
          enterTournamentLobby(id);
        }}
        onViewResult={(id) => {
          setActiveTournamentId(id);
          setTournamentSubView('result');
        }}
        // Registration keeps the player on the hub: the event may be hours away.
        onRegister={(id) => tournament.register(id)}
        onWithdraw={async (id) => {
          await tournament.withdraw(id);
          if (activeTournamentId === id) exitToTournamentHub('withdraw');
        }}
        onRetry={() => {
          void tournament.refresh();
        }}
        onBoundary={() => tournament.scheduleRefresh(0)}
      />
      </ErrorBoundary>
    </Suspense>,
  );
}

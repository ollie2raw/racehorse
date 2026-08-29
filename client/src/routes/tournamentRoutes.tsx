import React, { Suspense } from 'react';
import { ScreenLoader } from '../ui/ScreenLoader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import type {
  AppRoutesShellProps,
  AppRoutesNavigationProps,
  AppRoutesAuthProps,
  AppRoutesTournamentProps,
} from '../appRouteTypes';

const TournamentHubScreen = React.lazy(() => import('../tournament/TournamentHubScreen'));
const TournamentBracketScreen = React.lazy(() => import('../tournament/TournamentBracketScreen'));
const TournamentResultScreen = React.lazy(() => import('../tournament/TournamentResultScreen'));

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
          onSignOut={handleSignOut}
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
              void import('../tournament/tournamentApi')
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
        onSignOut={handleSignOut}
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

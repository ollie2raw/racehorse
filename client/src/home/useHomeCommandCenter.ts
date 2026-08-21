import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import type { AppRoutesTournamentProps } from '../appRouteTypes';
import {
  loadDailyFritz,
  loadDailyPuzzle,
  loadDailySummary,
  loadJourney,
  loadRanking,
  loadSocialActivity,
  loadSocialPresence,
  loadSocialRivals,
  loadTournament,
} from './homeDataLoaders';
import { selectHomePrimaryAction } from './homePrimaryAction';
import { calculateHomeMomentum } from './homeMomentum';
import { calculateWelcomeBack } from './homeWelcomeBack';
import { calculateHomePersonalization } from './homePersonalization';
import { buildHomeActivityTimeline } from './homeActivityTimeline';
import type {
  HomeCommandCenterModel,
  HomeIdentity,
  HomeSourceKey,
  HomeSourceState,
} from './homeTypes';

type TournamentHookState = AppRoutesTournamentProps['tournament'];

const ASYNC_KEYS: HomeSourceKey[] = [
  'dailySummary',
  'dailyFritz',
  'dailyPuzzle',
  'socialPresence',
  'socialActivity',
  'socialRivals',
  'ranking',
];

function emptySource<T>(status: HomeSourceState<T>['status']): HomeSourceState<T> {
  return { data: null, status, stale: false, error: null, fetchedAt: null };
}

function sourceStatus(model: HomeCommandCenterModel): Record<HomeSourceKey, HomeSourceState<unknown>['status']> {
  return {
    dailySummary: model.daily.summary.status,
    dailyFritz: model.daily.fritz.status,
    dailyPuzzle: model.daily.puzzle.status,
    socialPresence: model.social.presence.status,
    socialActivity: model.social.activity.status,
    socialRivals: model.social.rivals.status,
    tournament: model.tournament.status,
    journey: model.journey.status,
    ranking: model.stats.status,
    runtime: model.runtime.status,
  };
}

function createInitialModel(identity: HomeIdentity, tournament: TournamentHookState): HomeCommandCenterModel {
  const guest = identity.kind === 'guest';
  const dailyStatus = 'loading';
  const socialStatus = guest ? 'unavailable' : 'loading';
  const rankingStatus = guest ? 'unavailable' : 'loading';
  const tournamentStatus = tournament.error ? 'error' : tournament.isLoading && !tournament.hasLoaded ? 'loading' : 'ready';
  const journeyStatus = 'loading';
  const model: HomeCommandCenterModel = {
    identity,
    daily: {
      summary: emptySource(dailyStatus),
      fritz: emptySource(guest ? 'unavailable' : dailyStatus),
      puzzle: emptySource(dailyStatus),
    },
    social: {
      presence: emptySource(socialStatus),
      activity: emptySource(socialStatus),
      rivals: emptySource(socialStatus),
    },
    tournament: { ...emptySource(tournamentStatus), data: null },
    journey: emptySource(journeyStatus),
    stats: emptySource(rankingStatus),
    runtime: { data: { activeMatch: null, source: 'app-runtime-not-exposed' }, status: 'unavailable', stale: false, error: null, fetchedAt: null },
    continueItems: [],
    primaryAction: null,
    momentum: null,
    welcomeBack: null,
    activityTimeline: null,
    personalization: null,
    freshness: { generatedAt: Date.now(), stale: false },
    sourceStatus: {} as HomeCommandCenterModel['sourceStatus'],
  };
  model.sourceStatus = sourceStatus(model);
  return model;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useHomeCommandCenter(tournament: TournamentHookState): HomeCommandCenterModel {
  const { user, profile, loading: authLoading } = useAuth();
  const identity = useMemo<HomeIdentity>(() => ({
    kind: user ? 'authenticated' : 'guest',
    userId: user?.id ?? null,
    displayName: profile?.username ?? user?.email?.split('@')[0] ?? null,
  }), [profile?.username, user]);
  const [model, setModel] = useState(() => createInitialModel(identity, tournament));

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    const controller = new AbortController();
    const startedAt = Date.now();

    // Carry previously loaded data over as `stale` so a refresh doesn't flash the
    // whole screen back to skeletons. Only ever for the *same* identity: on a
    // logout or a user switch the old data belongs to someone else and must go.
    setModel((current) => {
      const next = createInitialModel(identity, tournament);
      const sameIdentity =
        current.identity.userId === identity.userId && current.identity.kind === identity.kind;
      if (!sameIdentity) return next;
      return {
        ...next,
        daily: {
          summary: current.daily.summary.data ? { ...current.daily.summary, stale: true } : next.daily.summary,
          fritz: current.daily.fritz.data ? { ...current.daily.fritz, stale: true } : next.daily.fritz,
          puzzle: current.daily.puzzle.data ? { ...current.daily.puzzle, stale: true } : next.daily.puzzle,
        },
        social: {
          presence: current.social.presence.data ? { ...current.social.presence, stale: true } : next.social.presence,
          activity: current.social.activity.data ? { ...current.social.activity, stale: true } : next.social.activity,
          rivals: current.social.rivals.data ? { ...current.social.rivals, stale: true } : next.social.rivals,
        },
        journey: current.journey.data ? { ...current.journey, stale: true } : next.journey,
        stats: current.stats.data ? { ...current.stats, stale: true } : next.stats,
      };
    });

    const commit = <T,>(section: keyof Pick<HomeCommandCenterModel, 'journey' | 'stats'>, data: T) => {
      if (cancelled || controller.signal.aborted) return;
      setModel((current) => {
        const updated = {
          ...current,
          [section]: { data, status: 'ready' as const, stale: false, error: null, fetchedAt: Date.now() },
          freshness: { generatedAt: startedAt, stale: false },
        } as HomeCommandCenterModel;
        updated.sourceStatus = sourceStatus(updated);
        return updated;
      });
    };
    const fail = (section: keyof Pick<HomeCommandCenterModel, 'journey' | 'stats'>, error: unknown) => {
      if (cancelled || controller.signal.aborted) return;
      setModel((current) => {
        const previous = current[section];
        const updated = {
          ...current,
          [section]: { ...previous, status: 'error' as const, stale: Boolean(previous.data), error: errorMessage(error) },
        } as HomeCommandCenterModel;
        updated.sourceStatus = sourceStatus(updated);
        return updated;
      });
    };
    const commitDaily = <T extends 'summary' | 'fritz' | 'puzzle'>(key: T, data: HomeCommandCenterModel['daily'][T]['data']) => {
      if (cancelled || controller.signal.aborted) return;
      setModel((current) => {
        const updated = {
          ...current,
          daily: {
            ...current.daily,
            [key]: { data, status: 'ready' as const, stale: false, error: null, fetchedAt: Date.now() },
          },
          freshness: { generatedAt: startedAt, stale: false },
        } as HomeCommandCenterModel;
        updated.sourceStatus = sourceStatus(updated);
        return updated;
      });
    };
    const failDaily = (key: 'summary' | 'fritz' | 'puzzle', error: unknown) => {
      if (cancelled || controller.signal.aborted) return;
      setModel((current) => {
        const previous = current.daily[key];
        const updated = {
          ...current,
          daily: { ...current.daily, [key]: { ...previous, status: 'error' as const, stale: Boolean(previous.data), error: errorMessage(error) } },
        } as HomeCommandCenterModel;
        updated.sourceStatus = sourceStatus(updated);
        return updated;
      });
    };
    const commitSocial = <T extends 'presence' | 'activity' | 'rivals'>(key: T, data: HomeCommandCenterModel['social'][T]['data']) => {
      if (cancelled || controller.signal.aborted) return;
      setModel((current) => {
        const updated = { ...current, social: { ...current.social, [key]: { data, status: 'ready' as const, stale: false, error: null, fetchedAt: Date.now() } } } as HomeCommandCenterModel;
        updated.sourceStatus = sourceStatus(updated);
        return updated;
      });
    };
    const failSocial = (key: 'presence' | 'activity' | 'rivals', error: unknown) => {
      if (cancelled || controller.signal.aborted) return;
      setModel((current) => {
        const previous = current.social[key];
        const updated = { ...current, social: { ...current.social, [key]: { ...previous, status: 'error' as const, stale: Boolean(previous.data), error: errorMessage(error) } } } as HomeCommandCenterModel;
        updated.sourceStatus = sourceStatus(updated);
        return updated;
      });
    };

    // These calls have no data dependency and are intentionally started together.
    void Promise.allSettled([
      loadDailySummary().then((data) => commitDaily('summary', data)).catch((error) => failDaily('summary', error)),
      ...(identity.userId
        ? [loadDailyFritz(true).then((data) => commitDaily('fritz', data)).catch((error) => failDaily('fritz', error))]
        : []),
      loadDailyPuzzle().then((data) => commitDaily('puzzle', data)).catch((error) => failDaily('puzzle', error)),
      ...(identity.userId
        ? [
            loadSocialPresence().then((data) => commitSocial('presence', data)).catch((error) => failSocial('presence', error)),
            loadSocialActivity().then((data) => commitSocial('activity', data)).catch((error) => failSocial('activity', error)),
            loadSocialRivals().then((data) => commitSocial('rivals', data)).catch((error) => failSocial('rivals', error)),
            loadRanking(identity.userId).then((data) => commit('stats', data)).catch((error) => fail('stats', error)),
          ]
        : []),
      loadJourney().then((data) => commit('journey', data)).catch((error) => fail('journey', error)),
    ]);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    authLoading,
    identity.kind,
    identity.userId,
  ]);

  // Synchronize tournament properties when they update, without triggering network refetches.
  useEffect(() => {
    let cancelled = false;
    const tournamentStatus = tournament.error
      ? 'error'
      : tournament.isLoading && !tournament.hasLoaded
      ? 'loading'
      : 'ready';

    if (tournamentStatus === 'ready') {
      loadTournament({
        upcoming: tournament.upcoming,
        registrations: tournament.registrations,
        activeTournamentId: tournament.activeTournamentId,
        tournamentPhase: tournament.tournamentPhase,
        recoveryMatch: tournament.recoveryMatch
          ? {
              matchId: tournament.recoveryMatch.matchId,
              tournamentId: tournament.recoveryMatch.tournamentId,
              round: tournament.recoveryMatch.round,
              opponentId: tournament.recoveryMatch.opponentId,
              opponentUsername: tournament.recoveryMatch.opponentUsername,
              matchStatus: tournament.recoveryMatch.matchStatus,
              readyDeadlineAt: tournament.recoveryMatch.readyDeadlineAt,
            }
          : null,
      })
        .then((data) => {
          if (cancelled) return;
          setModel((current) => {
            const updated = {
              ...current,
              tournament: { data, status: 'ready' as const, stale: false, error: null, fetchedAt: Date.now() },
            } as HomeCommandCenterModel;
            updated.sourceStatus = sourceStatus(updated);
            return updated;
          });
        })
        .catch((error) => {
          if (cancelled) return;
          setModel((current) => {
            const updated = {
              ...current,
              tournament: { ...current.tournament, status: 'error' as const, error: errorMessage(error) },
            } as HomeCommandCenterModel;
            updated.sourceStatus = sourceStatus(updated);
            return updated;
          });
        });
    } else {
      // Mirrors the tournament status straight from props; there is nothing to
      // await, so the update is intentionally synchronous.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModel((current) => {
        const updated = {
          ...current,
          tournament: {
            ...current.tournament,
            status: tournamentStatus as 'error' | 'loading',
            error: tournament.error ? errorMessage(tournament.error) : null,
          },
        } as HomeCommandCenterModel;
        updated.sourceStatus = sourceStatus(updated);
        return updated;
      });
    }

    return () => {
      cancelled = true;
    };
  }, [
    tournament.activeTournamentId,
    tournament.error,
    tournament.hasLoaded,
    tournament.isLoading,
    tournament.recoveryMatch,
    tournament.registrations,
    tournament.tournamentPhase,
    tournament.upcoming,
  ]);

  const result = model.identity.userId === (identity.userId ?? null) && model.identity.kind === identity.kind
    ? model
    : createInitialModel(identity, tournament);
  return useMemo(
    () => {
      const generatedAt = Date.now();
      const activityTimeline = buildHomeActivityTimeline(result, generatedAt);
      const modelWithTimeline = { ...result, activityTimeline };
      const personalization = calculateHomePersonalization(modelWithTimeline, generatedAt);
      return {
        ...modelWithTimeline,
        personalization,
        primaryAction: selectHomePrimaryAction({
          model: modelWithTimeline,
          timeline: activityTimeline,
          authStatus: authLoading ? 'loading' : 'ready',
        }),
        momentum: calculateHomeMomentum(modelWithTimeline, generatedAt),
        welcomeBack: calculateWelcomeBack({ model: modelWithTimeline, lastVisitAt: null }, generatedAt),
      };
    },
    [authLoading, result],
  );
}

export { ASYNC_KEYS };

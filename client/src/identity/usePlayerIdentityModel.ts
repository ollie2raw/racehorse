import { useEffect, useState } from 'react';
import { loadJourney } from '../home/homeDataLoaders';
import { fetchPersonalStatsInsightsByUserId } from '../stats/statsApi';
import type { PersonalStatsInsights } from '../stats/statsTypes';
import { fetchPublicProfile, fetchRivals } from '../social/socialApi';
import type { HomeJourneyModel } from '../home/homeTypes';
import { derivePlayerIdentity } from './playerIdentityDerivation';
import {
  applyJourney,
  applyPersonalInsights,
  applyPublicProfile,
  applyRivals,
  createEmptyPlayerIdentityModel,
  setIdentitySourceStatus,
} from './playerIdentityNormalization';
import type { PlayerIdentityModel, PlayerIdentityModelState, PlayerIdentityRequest } from './playerIdentityTypes';
import type { PlayerRivalSummary } from './playerIdentityTypes';

function seedModel(request: PlayerIdentityRequest, generatedAt: number): PlayerIdentityModel {
  const model = createEmptyPlayerIdentityModel(generatedAt);
  return {
    ...model,
    subject: {
      ...model.subject,
      userId: request.subjectUserId,
      username: request.subjectUsername,
      currentMode: null,
      isCurrentUser: Boolean(request.subjectUserId && request.subjectUserId === request.currentUserId),
      friendshipStatus: request.subjectUserId && request.subjectUserId === request.currentUserId ? 'self' : 'unknown',
    },
    sourceStatus: {
      public_profile: request.subjectUsername ? 'loading' : 'unavailable',
      personal_insights: request.subjectUserId === request.currentUserId && request.currentUserId ? 'loading' : 'unavailable',
      journey: request.subjectUserId === request.currentUserId && request.currentUserId ? 'loading' : 'unavailable',
      rivals: request.subjectUserId === request.currentUserId && request.currentUserId ? 'loading' : 'unavailable',
    },
  };
}

async function loadModel(request: PlayerIdentityRequest, generatedAt: number): Promise<{ model: PlayerIdentityModel; error: string | null }> {
  let model = seedModel(request, generatedAt);
  const errors: string[] = [];

  const knownCurrentSubject = Boolean(request.subjectUserId && request.subjectUserId === request.currentUserId);
  let privateInsights: PersonalStatsInsights | null = null;
  let privateJourney: HomeJourneyModel | null = null;
  let privateRivals: PlayerRivalSummary[] | null = null;
  if (knownCurrentSubject) {
    const [insightsResult, journeyResult, rivalsResult] = await Promise.allSettled([
      fetchPersonalStatsInsightsByUserId(request.subjectUserId!),
      loadJourney(),
      fetchRivals(),
    ]);
    if (insightsResult.status === 'fulfilled' && insightsResult.value.data) {
      privateInsights = insightsResult.value.data;
      model = applyPersonalInsights(model, insightsResult.value.data);
    }
    else {
      model = setIdentitySourceStatus(model, 'personal_insights', 'error');
      if (insightsResult.status === 'fulfilled' && insightsResult.value.error) errors.push(insightsResult.value.error);
    }
    if (journeyResult.status === 'fulfilled') {
      privateJourney = journeyResult.value;
      model = applyJourney(model, journeyResult.value);
    }
    else model = setIdentitySourceStatus(model, 'journey', 'error');
    if (rivalsResult.status === 'fulfilled' && !rivalsResult.value.error) {
      privateRivals = rivalsResult.value.rivals;
      model = applyRivals(model, rivalsResult.value.rivals);
    }
    else {
      model = setIdentitySourceStatus(model, 'rivals', 'error');
      if (rivalsResult.status === 'fulfilled' && rivalsResult.value.error) errors.push(rivalsResult.value.error);
    }
  }

  if (request.subjectUsername) {
    const publicResult = await fetchPublicProfile(request.subjectUsername);
    if (publicResult.profile) {
      model = applyPublicProfile(model, publicResult.profile, request.currentUserId);
    } else {
      model = setIdentitySourceStatus(model, 'public_profile', 'error');
      if (publicResult.error) errors.push(publicResult.error);
    }

    if (knownCurrentSubject) {
      if (privateInsights) model = applyPersonalInsights(model, privateInsights);
      if (privateJourney) model = applyJourney(model, privateJourney);
      if (privateRivals) model = applyRivals(model, privateRivals);
    }

    const resolvedCurrent = !knownCurrentSubject && model.subject.isCurrentUser && model.subject.userId === request.currentUserId;
    if (resolvedCurrent && request.currentUserId) {
      const [insightsResult, journeyResult, rivalsResult] = await Promise.allSettled([
        fetchPersonalStatsInsightsByUserId(request.currentUserId),
        loadJourney(),
        fetchRivals(),
      ]);
      if (insightsResult.status === 'fulfilled' && insightsResult.value.data) model = applyPersonalInsights(model, insightsResult.value.data);
      else model = setIdentitySourceStatus(model, 'personal_insights', 'error');
      if (journeyResult.status === 'fulfilled') model = applyJourney(model, journeyResult.value);
      else model = setIdentitySourceStatus(model, 'journey', 'error');
      if (rivalsResult.status === 'fulfilled' && !rivalsResult.value.error) model = applyRivals(model, rivalsResult.value.rivals);
      else model = setIdentitySourceStatus(model, 'rivals', 'error');
    }
  }

  return { model: derivePlayerIdentity(model), error: errors[0] ?? null };
}

export function usePlayerIdentityModel(request: PlayerIdentityRequest): PlayerIdentityModelState {
  const [state, setState] = useState<PlayerIdentityModelState>(() => ({
    model: seedModel(request, Date.now()),
    loading: Boolean(request.subjectUsername || (request.subjectUserId && request.subjectUserId === request.currentUserId)),
    error: null,
  }));

  useEffect(() => {
    let cancelled = false;
    const generatedAt = Date.now();
    setState({
      model: seedModel(request, generatedAt),
      loading: Boolean(request.subjectUsername || (request.subjectUserId && request.subjectUserId === request.currentUserId)),
      error: null,
    });
    if (!request.subjectUsername && !(request.subjectUserId && request.subjectUserId === request.currentUserId)) return () => { cancelled = true; };

    void loadModel(request, generatedAt).then((result) => {
      if (cancelled) return;
      setState({ model: result.model, loading: false, error: result.error });
    }).catch((error: unknown) => {
      if (cancelled) return;
      setState({ model: setIdentitySourceStatus(seedModel(request, generatedAt), 'public_profile', 'error'), loading: false, error: error instanceof Error ? error.message : 'Player identity unavailable.' });
    });

    return () => { cancelled = true; };
  }, [request.currentUserId, request.subjectUserId, request.subjectUsername]);

  return state;
}

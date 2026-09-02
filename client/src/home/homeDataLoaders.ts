import { getTodayDailyFritz } from '../dailyFritz/api';
import { getHomeDailySummary } from '../features/daily/homeDailySummaryApi';
import { fetchActivityFeed, fetchFriendsWithPresence, fetchRivals } from '../social/socialApi';
import { fetchRankingProfile } from '../stats/statsApi';
import { getJourneyHomeSummary } from '../journey/journeyHomeSummary';
import { loadJourneyProgress } from '../journey/journeyStorage';
import type { HomeSourceKey } from './homeTypes';
import {
  normalizeDailyFritz,
  normalizeDailySummary,
  normalizeJourney,
  normalizeRanking,
  normalizeSocial,
  normalizeTournament,
} from './homeNormalization';
import type {
  DailyFritzModel,
  HomeJourneyModel,
  HomeRankingModel,
  HomeSocialModel,
  HomeTournamentModel,
} from './homeTypes';

export type HomeTournamentSnapshot = Parameters<typeof normalizeTournament>[0];

export async function loadDailySummary() {
  return normalizeDailySummary(await getHomeDailySummary());
}

export async function loadDailyFritz(authenticated: boolean): Promise<DailyFritzModel> {
  if (!authenticated) throw new Error('Daily Fritz requires authentication');
  return normalizeDailyFritz(await getTodayDailyFritz());
}

export async function loadSocial(): Promise<HomeSocialModel> {
  const [friends, activity, rivals] = await Promise.all([
    fetchFriendsWithPresence(),
    fetchActivityFeed(),
    fetchRivals(),
  ]);
  if (friends.error) throw new Error(friends.error);
  if (activity.error) throw new Error(activity.error);
  if (rivals.error) throw new Error(rivals.error);
  return normalizeSocial(friends.friends, activity.feed, rivals.rivals);
}

export async function loadSocialPresence() {
  const result = await fetchFriendsWithPresence();
  if (result.error) throw new Error(result.error);
  return normalizeSocial(result.friends, [], []).friends;
}

export async function loadSocialActivity() {
  const result = await fetchActivityFeed();
  if (result.error) throw new Error(result.error);
  return normalizeSocial([], result.feed, []).activity;
}

export async function loadSocialRivals() {
  const result = await fetchRivals();
  if (result.error) throw new Error(result.error);
  return normalizeSocial([], [], result.rivals).rivals;
}

export async function loadTournament(snapshot: HomeTournamentSnapshot): Promise<HomeTournamentModel> {
  return normalizeTournament(snapshot);
}

export async function loadJourney(): Promise<HomeJourneyModel> {
  const progress = loadJourneyProgress();
  return normalizeJourney(progress, getJourneyHomeSummary(progress));
}

export async function loadRanking(userId: string | null): Promise<HomeRankingModel> {
  if (!userId) throw new Error('Ranking requires authentication');
  const result = await fetchRankingProfile(userId);
  if (result.error || !result.data) throw new Error(result.error ?? 'Ranking unavailable');
  return normalizeRanking(result.data);
}

export type HomeLoaderKey = Exclude<HomeSourceKey, 'runtime'>;

export type HomeLoaderMap = {
  dailySummary: typeof loadDailySummary;
  dailyFritz: typeof loadDailyFritz;
  social: typeof loadSocial;
  tournament: typeof loadTournament;
  journey: typeof loadJourney;
  ranking: typeof loadRanking;
};

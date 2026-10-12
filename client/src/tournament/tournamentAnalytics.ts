/**
 * Tournament launch analytics (Phase 3E), through the app's one analytics
 * module (lib/analytics → PostHog). Calls sit in API wrappers, user gestures,
 * and observed state transitions — not in render — and the derived events are
 * de-duplicated for the app session, so refetches, rerenders, socket
 * reconnects and foregrounding never re-send them. Best-effort: nothing here
 * can throw into, or wait on, the product flow.
 *
 * Properties are limited to: kind, round, fritz_tier, error_code, placement,
 * outcome_kind. Never usernames, user / tournament / bot ids, or room state.
 */
import { track, type AnalyticsEvent, type AnalyticsProps } from '../lib/analytics';
import { botTierForRound, isTournamentBotId } from './displayNames';
import type { MyTournament, TournamentKind, TournamentOutcomeKind } from './types';

type TournamentProps = {
  kind?: TournamentKind | null;
  round?: 1 | 2 | 3 | null;
  fritz_tier?: 'standard' | 'elite' | 'master' | null;
  error_code?: string | null;
  placement?: number | null;
  outcome_kind?: TournamentOutcomeKind | null;
};

function send(event: AnalyticsEvent, props: TournamentProps = {}): void {
  try {
    const clean: AnalyticsProps = {};
    for (const [key, value] of Object.entries(props)) if (value !== null && value !== undefined) clean[key] = value;
    track(event, clean);
  } catch {
    // Analytics never blocks a tournament flow.
  }
}

// ── per-session de-duplication ──────────────────────────────────────────────

const readyMatchIds = new Set<string>();
const joinedMatchIds = new Set<string>();
/** Last registration status seen per tournament this session (terminal events fire on the transition). */
const lastStatusByTournament = new Map<string, string>();

export function resetTournamentAnalyticsForTests(): void {
  readyMatchIds.clear();
  joinedMatchIds.clear();
  lastStatusByTournament.clear();
  gameContext = null;
}

// ── direct events (gestures / API results) ───────────────────────────────────

export const trackTournamentHubViewed = (): void => send('tournament_hub_viewed');
export const trackFritzCupTapped = (): void => send('fritz_cup_tapped', { kind: 'fritz_cup' });
export const trackFritzCupCreated = (): void => send('fritz_cup_created', { kind: 'fritz_cup' });
export const trackFritzCupCreateFailed = (errorCode: string): void =>
  send('fritz_cup_create_failed', { kind: 'fritz_cup', error_code: errorCode });
export const trackLiveEventRegisterTapped = (): void => send('live_event_register_tapped', { kind: 'live' });
export const trackLiveEventRegistered = (): void => send('live_event_registered', { kind: 'live' });
export const trackLiveEventRegistrationFailed = (errorCode: string): void =>
  send('live_event_registration_failed', { kind: 'live', error_code: errorCode });

// ── derived events (de-duplicated) ───────────────────────────────────────────

/** A ready match observed (from /my or match_ready): once per match id. */
export function trackTournamentMatchReady(match: { matchId: string; round: 1 | 2 | 3 }, kind: TournamentKind | null): void {
  if (readyMatchIds.has(match.matchId)) return;
  readyMatchIds.add(match.matchId);
  send('tournament_match_ready', { kind, round: match.round });
}

/** The player joined their match: once per match id. */
export function trackTournamentMatchJoined(
  match: { matchId: string; round: 1 | 2 | 3; opponentId?: string | null },
  kind: TournamentKind | null,
): void {
  if (joinedMatchIds.has(match.matchId)) return;
  joinedMatchIds.add(match.matchId);
  send('tournament_match_joined', {
    kind,
    round: match.round,
    fritz_tier: isTournamentBotId(match.opponentId) ? botTierForRound(match.round) : null,
  });
}

/**
 * Eliminated / champion: fired when /my shows the player's registration move
 * into that state during this session (not for an old result on first load),
 * once per tournament.
 */
export function observeMyTournamentsForAnalytics(tournaments: MyTournament[]): void {
  for (const t of tournaments) {
    const status = t.myRegistration.status;
    const previous = lastStatusByTournament.get(t.id);
    lastStatusByTournament.set(t.id, status);
    if (previous === undefined || previous === status) continue;
    if (previous !== 'registered' && previous !== 'active') continue;
    const props: TournamentProps = {
      kind: t.kind ?? 'live',
      placement: t.myRegistration.placement,
      round: t.myLastMatch?.round ?? null,
      outcome_kind: t.myLastMatch?.outcomeKind ?? null,
      fritz_tier: t.myLastMatch?.opponentBotTier ?? null,
    };
    if (status === 'winner') send('tournament_champion', props);
    else if (status === 'eliminated') send('tournament_eliminated', props);
  }
}

// ── game_opened / game_completed context ────────────────────────────────────

let gameContext: { roomCode: string; kind: TournamentKind | null; round: 1 | 2 | 3 } | null = null;

/** The tournament match being played (set on attach), so game events can say so. */
export function setTournamentGameContext(context: { roomCode: string; kind: TournamentKind | null; round: 1 | 2 | 3 } | null): void {
  gameContext = context;
}

export function clearTournamentGameContext(roomCode: string | null | undefined): void {
  if (gameContext && (!roomCode || gameContext.roomCode.toUpperCase() === roomCode.toUpperCase())) gameContext = null;
}

/** Extra props for game_opened / game_completed in a tournament room (empty otherwise). */
export function tournamentGameProps(): AnalyticsProps {
  if (!gameContext) return {};
  const props: AnalyticsProps = { tournament: true, round: gameContext.round };
  if (gameContext.kind) props.kind = gameContext.kind;
  return props;
}

export function tournamentKindOf(myTournaments: MyTournament[], tournamentId: string): TournamentKind | null {
  const t = myTournaments.find((row) => row.id === tournamentId);
  return t ? t.kind ?? 'live' : null;
}

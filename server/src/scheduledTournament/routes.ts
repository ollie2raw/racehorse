import * as Sentry from '@sentry/node';
import { childLogger } from '../logger';
import type { Express, Request, Response } from 'express';
import type { Server } from 'socket.io';
import { createRateLimitMiddleware, InMemoryRateLimiter } from '../rateLimit';
import { isSupabaseTimeoutError, supabaseFetch } from '../supabaseUtils';
import { placementLabelForRank } from './engine';
import {
  fetchRegistrationsWithProfile,
  fetchUpcomingTournaments,
  fetchTournamentById,
  fetchBracketView,
  fetchActiveAssignedMatchForUser,
  fetchRegistrationsForUser,
  fetchRegistrations,
  fetchMatches,
  fetchMatchesForTournaments,
  fetchTournamentsByIds,
  isValidUuid,
  registerForTournament,
  REGISTRATION_RPC_ERRORS,
  overlapConflictPayload,
  TournamentRpcError,
  withdrawFromTournament,
} from './persistence';
import { startOrResumeFritzCup } from './fritzCup';
import { withServerNow } from './serverNow';
import type { MatchRow, ScheduledTournamentRow } from './types';
import { botLabel, humanJoinedAt, isBotUserId } from './matchDispatch';
import { buildTournamentMeState } from './meState';
import {
  rejectMismatchedPayloadUserId,
  requireAuthUserId,
  sendAuthError,
} from './tournamentAuth';
import { isFritzCupEnabled, respondIfTournamentsDisabled, tournamentFeatures, TOURNAMENTS_DISABLED } from './tournamentsFeature';
import { tournamentOutcomeKind, userLastMatchOutcome } from './outcomeKind';
import { HISTORY_READ_CONCURRENCY, mapInBatches, parseHistoryPage, publicBracketMatch } from './publicBracket';
import { TOURNAMENT_ACTIVE_WINDOW_MS } from './activeWindow';

const log = childLogger('tournament:routes');

async function requireAuth(
  req: Request,
  res: Response,
  opts: { allowAnonymous?: boolean } = {},
): Promise<string | null> {
  return requireAuthUserId(req, res, opts);
}

/**
 * Registration / withdrawal RPC failures carry a stable code (see
 * REGISTRATION_RPC_ERRORS). Map it to an HTTP status; anything else is a 500.
 */
function sendRegistrationRpcError(res: Response, err: unknown): void {
  const code = err instanceof Error ? err.message : 'internal';
  if (!REGISTRATION_RPC_ERRORS.has(code)) {
    sendInternal(res, err);
    return;
  }
  const status = code === 'tournament_not_found' ? 404 : code === 'invalid_user' ? 400 : 409;
  res.status(status).json({
    ok: false,
    error: code === 'tournament_not_found' ? 'not_found' : code,
    ...(code === 'overlapping_tournament' ? { conflict: overlapConflictPayload(err) } : {}),
  });
}

/** A tournament row as public responses show it: the Fritz Cup owner id stays server-side. */
function publicTournament<T extends Partial<ScheduledTournamentRow>>(tournament: T): Omit<T, 'owner_user_id'> & { kind: string } {
  const { owner_user_id: _owner, ...rest } = tournament;
  return { ...rest, kind: tournament.kind ?? 'live' };
}

/** POST /api/tournaments/fritz-cup: 10 requests per 10 minutes per IP (the database limits are authoritative). */
const FRITZ_CUP_RATE_RULE = { windowMs: 10 * 60_000, max: 10 };
const fritzCupRateLimit = createRateLimitMiddleware(
  new InMemoryRateLimiter(FRITZ_CUP_RATE_RULE),
  FRITZ_CUP_RATE_RULE,
  'rest:fritz-cup',
);

/** The start_fritz_cup refusals as HTTP; anything unexpected is a plain 500 `internal`. */
function sendFritzCupError(res: Response, err: unknown): void {
  const code = err instanceof Error ? err.message : '';
  if (code === 'overlapping_tournament') {
    res.status(409).json({ ok: false, error: code, conflict: overlapConflictPayload(err) });
    return;
  }
  if (code === 'fritz_cup_cooldown') {
    const details = err instanceof TournamentRpcError ? err.details : null;
    const retryAfterMs = Number(details?.retry_after_ms);
    res.status(429).json({
      ok: false,
      error: code,
      retryAfterMs: Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.ceil(retryAfterMs) : 60_000,
      reason: details?.reason === 'daily_limit' ? 'daily_limit' : 'cooldown',
    });
    return;
  }
  if (code === 'invalid_user') {
    res.status(400).json({ ok: false, error: code });
    return;
  }
  sendInternal(res, err);
}

/** An unexpected failure: logged in full here, `internal` to the client (never raw error text). */
function sendInternal(res: Response, err: unknown): void {
  log.error({ err }, 'tournament request failed');
  Sentry.captureException(err);
  res.status(500).json({ ok: false, error: 'internal' });
}

type TournamentRouteHandler = (req: Request, res: Response) => unknown | Promise<unknown>;

/**
 * The tournament API contract, applied to every tournament route: each JSON
 * object body (success or error, including those sent by shared helpers —
 * auth, the feature switch, the rate limiter) gains `serverNow`, an error body
 * without `ok` gains `ok: false`, and anything thrown becomes a logged
 * 500 `internal`.
 */
function tournamentRoute(handler: TournamentRouteHandler): TournamentRouteHandler {
  return async (req, res) => {
    const send = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const b = body as Record<string, unknown>;
        const normalized = b.ok === undefined && typeof b.error === 'string' ? { ok: false, ...b } : b;
        return send(withServerNow(normalized));
      }
      return send(body);
    }) as Response['json'];
    try {
      await handler(req, res);
    } catch (err) {
      if (!res.headersSent) sendInternal(res, err);
      else log.error({ err }, 'tournament request failed after responding');
    }
  };
}

/** The user's playable assigned match, as /me reports it (null if none is playable now). */
function assignedMatchPayload(
  userId: string,
  active: Awaited<ReturnType<typeof fetchActiveAssignedMatchForUser>>,
) {
  if (!active) return null;
  const { match, tournament, opponentUsername } = active;
  if (
    tournament.status !== 'in_progress' ||
    (match.status !== 'ready' && match.status !== 'in_progress') ||
    match.completed_at ||
    match.winner_id
  ) {
    return null;
  }
  if (Date.parse(tournament.scheduled_start) > Date.now()) {
    return null;
  }
  const humanAttached = Boolean(humanJoinedAt(match, userId));
  const matchStatus =
    match.status === 'in_progress' && !humanAttached
      ? 'ready'
      : match.status === 'ready' || match.status === 'in_progress'
        ? match.status
        : 'ready';
  const opponentId =
    match.player1_id === userId ? match.player2_id : match.player1_id;
  return {
    matchId: match.id,
    tournamentId: tournament.id,
    round: match.round,
    matchNumber: match.match_number,
    roomCode: match.room_code,
    opponentId,
    opponentUsername:
      opponentId && isBotUserId(opponentId)
        ? opponentUsername ?? 'Fritz'
        : opponentUsername,
    matchStatus,
    readyDeadlineAt: match.ready_deadline_at,
  };
}

function requireTournamentId(req: Request, res: Response): string | null {
  const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
  if (!isValidUuid(id)) {
    res.status(400).json({ ok: false, error: 'invalid_tournament_id' });
    return null;
  }
  return id;
}

/** Terminal tournaments stay in /my this long after their start (the active window plus 2 h to show the result). */
export const MY_RECENT_TERMINAL_MS = TOURNAMENT_ACTIVE_WINDOW_MS + 2 * 60 * 60 * 1000;

/**
 * Which of the user's tournaments /my reports: every one not yet finished
 * (upcoming, open, in progress — whatever its age), and a finished
 * (completed / cancelled) one until MY_RECENT_TERMINAL_MS after its start.
 */
export function isRelevantForMy(t: Pick<ScheduledTournamentRow, 'status' | 'scheduled_start' | 'winner_id'>, nowMs: number): boolean {
  if (t.status === 'upcoming' || t.status === 'registration_open' || t.status === 'in_progress') return true;
  const startMs = Date.parse(t.scheduled_start);
  return Number.isFinite(startMs) && nowMs - startMs <= MY_RECENT_TERMINAL_MS;
}

/** Humans registered for a Live Event still in registration (as /upcoming counts them); null otherwise (and always for a Fritz Cup). */
async function liveRegisteredCount(t: ScheduledTournamentRow): Promise<number | null> {
  if ((t.kind ?? 'live') !== 'live') return null;
  if (t.status !== 'upcoming' && t.status !== 'registration_open') return null;
  const regs = await fetchRegistrations(t.id);
  return regs.filter((r) => r.status === 'registered').length;
}

/**
 * The champion as clients show it. A Fritz champion has no registration (and
 * so no username): it is named by the final's tier ("Master Fritz"), never by
 * its internal id.
 */
function championDisplay(
  winnerId: string | null,
  username: string | null,
  matches: ReadonlyArray<Pick<MatchRow, 'round' | 'bot_tier'>>,
): { championName: string | null; championIsFritz: boolean; championFritzTier: MatchRow['bot_tier'] } {
  if (!winnerId) return { championName: null, championIsFritz: false, championFritzTier: null };
  if (isBotUserId(winnerId)) {
    const tier = matches.find((m) => m.round === 3)?.bot_tier ?? 'master';
    return { championName: botLabel(tier), championIsFritz: true, championFritzTier: tier };
  }
  return { championName: username, championIsFritz: false, championFritzTier: null };
}

export function registerTournamentRoutes(expressApp: Express, io?: Server): void {
  // Every tournament route goes through the API contract (tournamentRoute).
  const app = {
    get: (path: string, handler: TournamentRouteHandler) => expressApp.get(path, tournamentRoute(handler)),
    post: (path: string, handler: TournamentRouteHandler) => expressApp.post(path, tournamentRoute(handler)),
    delete: (path: string, handler: TournamentRouteHandler) => expressApp.delete(path, tournamentRoute(handler)),
  };
  // Static paths must be registered before /:id so "me", "upcoming", etc. are not captured.
  app.get('/api/tournaments/upcoming', async (_req: Request, res: Response) => {
    if (respondIfTournamentsDisabled(res, 'upcoming')) return;
    const startedAt = Date.now();
    try {
      const tournaments = await fetchUpcomingTournaments(5);
      const enriched = await Promise.all(
        tournaments.map(async (t) => {
          const regs = await fetchRegistrations(t.id);
          const registeredCount = regs.filter((r) => r.status === 'registered').length;
          return { ...t, registered_count: registeredCount };
        }),
      );
      res.json({ ok: true, tournaments: enriched.map(publicTournament), features: tournamentFeatures() });
    } catch (err) {
      if (isSupabaseTimeoutError(err)) {
        log.warn({ ms: Date.now() - startedAt, err }, 'upstream timeout');
        res.status(503).json({ ok: false, error: 'upstream_timeout', tournaments: [] });
        return;
      }
      sendInternal(res, err);
    }
  });

  // An on-demand Fritz Cup for the authenticated user (no ids in the body):
  // their active cup, or a new one, started at once (see fritzCup.ts).
  app.post('/api/tournaments/fritz-cup', async (req: Request, res: Response) => {
    if (respondIfTournamentsDisabled(res, 'refuse')) return;
    if (!isFritzCupEnabled()) {
      res.status(403).json(TOURNAMENTS_DISABLED);
      return;
    }
    let withinLimit = false;
    fritzCupRateLimit(req, res, () => { withinLimit = true; });
    if (!withinLimit) return;
    // A guest (anonymous session) is signed in but may not take part in tournaments until they make an account.
    const userId = await requireAuthUserId(req, res, { rejectGuests: true });
    if (!userId) return;
    if (!io) {
      log.error('fritz cup route registered without a socket server');
      res.status(500).json({ ok: false, error: 'internal' });
      return;
    }
    try {
      const started = await startOrResumeFritzCup(io, userId);
      const active = await fetchActiveAssignedMatchForUser(userId).catch(() => null);
      const assigned = assignedMatchPayload(userId, active);
      res.json({
        ok: true,
        existing: started.existing,
        kind: 'fritz_cup',
        tournament: publicTournament(started.tournament),
        activeAssignedMatch: assigned?.tournamentId === started.tournament.id ? assigned : null,
      });
    } catch (err) {
      sendFritzCupError(res, err);
    }
  });

  app.get('/api/tournaments/my', async (req: Request, res: Response) => {
    if (respondIfTournamentsDisabled(res, 'my')) return;
    const userId = await requireAuth(req, res);
    if (!userId) return;
    try {
      const regs = await fetchRegistrationsForUser(userId);
      const held = regs.filter((reg) => reg.status !== 'withdrawn');
      const ids = [...new Set(held.map((reg) => reg.tournament_id))];
      const [rows, active] = await Promise.all([
        ids.length > 0 ? fetchTournamentsByIds(ids) : Promise.resolve([] as ScheduledTournamentRow[]),
        fetchActiveAssignedMatchForUser(userId),
      ]);
      const nowMs = Date.now();
      const relevant = rows
        .filter((t) => isRelevantForMy(t, nowMs))
        .sort((a, b) => Date.parse(a.scheduled_start) - Date.parse(b.scheduled_start));
      const decided = relevant.filter((t) => t.status === 'completed' || t.status === 'in_progress');
      const [matchesById, counts] = await Promise.all([
        decided.length > 0 ? fetchMatchesForTournaments(decided.map((t) => t.id)) : Promise.resolve(new Map()),
        Promise.all(relevant.map(async (t) => [t.id, await liveRegisteredCount(t)] as const)),
      ]);
      const countById = new Map(counts);
      const tournaments = relevant.map((t) => {
        const reg = held.find((r) => r.tournament_id === t.id)!;
        return {
          ...publicTournament(t),
          registered_count: countById.get(t.id) ?? null,
          myRegistration: {
            status: reg.status,
            placement: reg.placement,
            placementLabel: reg.placement != null ? placementLabelForRank(reg.placement) : null,
            seed: reg.seed,
          },
          myLastMatch: userLastMatchOutcome(matchesById.get(t.id) ?? [], userId),
        };
      });
      res.json({
        ok: true,
        registrations: regs,
        tournaments,
        activeAssignedMatch: assignedMatchPayload(userId, active),
        features: tournamentFeatures(),
      });
    } catch (err) {
      sendInternal(res, err);
    }
  });

  app.get('/api/tournaments/me', async (req: Request, res: Response) => {
    if (respondIfTournamentsDisabled(res, 'me')) return;
    const userId = await requireAuth(req, res, { allowAnonymous: true });
    if (!userId) {
      res.json({
        ok: true,
        registrations: [],
        activeAssignedMatch: null,
        currentTournamentPhase: null,
        activeTournamentId: null,
        assignedMatch: null,
        countdown: null,
      });
      return;
    }
    try {
      const regs = await fetchRegistrationsForUser(userId);
      const tournamentIds = [...new Set(regs.map((reg) => reg.tournament_id))];
      // Two batched reads instead of two per registration (up to 100).
      const [tournamentRows, matchesByTournamentId] = await Promise.all([
        fetchTournamentsByIds(tournamentIds),
        fetchMatchesForTournaments(tournamentIds),
      ]);
      const tournamentsById = new Map(tournamentRows.map((t) => [t.id, t] as const));
      const opponentIds = new Set<string>();
      for (const matches of matchesByTournamentId.values()) {
        for (const match of matches) {
          for (const pid of [match.player1_id, match.player2_id]) {
            if (pid && !isBotUserId(pid)) opponentIds.add(pid);
          }
        }
      }
      const opponentUsernameByUserId = new Map<string, string | null>();
      if (opponentIds.size > 0) {
        const inClause = [...opponentIds].map((id) => `"${id}"`).join(',');
        const profiles = await supabaseFetch<Array<{ id: string; username: string | null }>>(
          `/rest/v1/profiles?select=id,username&id=in.(${inClause})`,
        ).catch(() => []);
        for (const profile of profiles) {
          opponentUsernameByUserId.set(profile.id, profile.username ?? null);
        }
      }

      const meState = buildTournamentMeState({
        userId,
        registrations: regs,
        tournamentsById,
        matchesByTournamentId,
        opponentUsernameByUserId,
      });

      const activeAssignedPayload = assignedMatchPayload(userId, await fetchActiveAssignedMatchForUser(userId));

      if (activeAssignedPayload) {
        log.info({ userId, matchId: activeAssignedPayload.matchId, status: activeAssignedPayload.matchStatus, round: activeAssignedPayload.round }, 'recovery activeAssignedMatch');
      }

      if (meState.currentTournamentPhase === 'completed' && meState.activeTournamentId) {
        const completedMatch = [...matchesByTournamentId.values()]
          .flat()
          .filter(
            (match) =>
              (match.player1_id === userId || match.player2_id === userId) &&
              (match.status === 'completed' || match.completed_at || match.winner_id),
          )
          .sort((a, b) => Date.parse(b.completed_at ?? '') - Date.parse(a.completed_at ?? ''))[0];
        log.info({ tournamentId: meState.activeTournamentId, matchId: completedMatch?.id ?? null }, 'completed result state');
      }

      res.json({
        ok: true,
        registrations: regs,
        activeAssignedMatch: activeAssignedPayload,
        currentTournamentPhase: meState.currentTournamentPhase,
        activeTournamentId: meState.activeTournamentId,
        assignedMatch: meState.assignedMatch,
        countdown: meState.countdown,
      });
    } catch (err) {
      sendInternal(res, err);
    }
  });

  app.get('/api/tournaments/history', async (req: Request, res: Response) => {
    if (respondIfTournamentsDisabled(res, 'history')) return;
    const userId = await requireAuth(req, res);
    if (!userId) return;
    try {
      const { limit, offset } = parseHistoryPage(req.query ?? {});
      const regs = await fetchRegistrationsForUser(userId);
      // Newest registration first, so a page is the player's most recent tournaments; each one costs three reads, so only a page is read.
      const completedRegs = regs
        .filter((reg) => reg.placement !== null)
        .sort((a, b) => Date.parse(b.registered_at) - Date.parse(a.registered_at));
      const pageRegs = completedRegs.slice(offset, offset + limit);
      const history = await mapInBatches(
        pageRegs,
        HISTORY_READ_CONCURRENCY,
        async (reg) => {
          const [tournament, withProfiles, matches] = await Promise.all([
            fetchTournamentById(reg.tournament_id),
            fetchRegistrationsWithProfile(reg.tournament_id),
            fetchMatches(reg.tournament_id),
          ]);
          if (!tournament) return null;
          const champion = withProfiles.find((entry) => entry.user_id === tournament.winner_id) ?? null;
          return {
            tournamentId: tournament.id,
            kind: tournament.kind ?? 'live',
            scheduledStart: tournament.scheduled_start,
            format: tournament.format,
            winTarget: tournament.win_target,
            placement: reg.placement,
            placementLabel: placementLabelForRank(reg.placement),
            championId: tournament.winner_id,
            ...championDisplay(tournament.winner_id, champion?.username ?? null, matches),
            // The user's own last match (their exit, or the final they won) — not the tournament's final.
            myLastMatch: userLastMatchOutcome(matches, userId),
          };
        },
      );
      const filteredHistory = history.filter(
        (entry): entry is NonNullable<typeof entry> => Boolean(entry),
      );
      res.json({
        ok: true,
        history: filteredHistory.sort(
          (a, b) => Date.parse(b.scheduledStart) - Date.parse(a.scheduledStart),
        ),
        total: completedRegs.length,
        limit,
        offset,
        hasMore: offset + pageRegs.length < completedRegs.length,
      });
    } catch (err) {
      sendInternal(res, err);
    }
  });

  app.get('/api/tournaments/:id/bracket', async (req: Request, res: Response) => {
    if (respondIfTournamentsDisabled(res, 'refuse')) return;
    const tournamentId = requireTournamentId(req, res);
    if (!tournamentId) return;
    try {
      const view = await fetchBracketView(tournamentId);
      if (!view) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
      res.json({
        ok: true,
        view: {
          ...view,
          tournament: publicTournament(view.tournament),
          // A fixed list of fields: this endpoint needs no sign-in, so a row's room code and lobby timing are not part of it (publicBracket.ts).
          matches: view.matches.map(publicBracketMatch),
        },
      });
    } catch (err) {
      sendInternal(res, err);
    }
  });

  app.get('/api/tournaments/:id', async (req: Request, res: Response) => {
    if (respondIfTournamentsDisabled(res, 'refuse')) return;
    const tournamentId = requireTournamentId(req, res);
    if (!tournamentId) return;
    try {
      const t = await fetchTournamentById(tournamentId);
      if (!t) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
      res.json({ ok: true, tournament: publicTournament(t) });
    } catch (err) {
      sendInternal(res, err);
    }
  });

  app.get('/api/tournaments/:id/result', async (req: Request, res: Response) => {
    if (respondIfTournamentsDisabled(res, 'refuse')) return;
    const tournamentId = requireTournamentId(req, res);
    if (!tournamentId) return;
    try {
      const view = await fetchBracketView(tournamentId);
      if (!view) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
      if (view.tournament.status !== 'completed') {
        res.status(409).json({ ok: false, error: 'not_completed' });
        return;
      }
      const champion = view.registrations.find((reg) => reg.user_id === view.tournament.winner_id) ?? null;
      const finalMatch = view.matches.find((m) => m.round === 3) ?? null;
      res.json({
        ok: true,
        result: {
          tournamentId: view.tournament.id,
          kind: view.tournament.kind ?? 'live',
          scheduledStart: view.tournament.scheduled_start,
          format: view.tournament.format,
          winTarget: view.tournament.win_target,
          championId: view.tournament.winner_id,
          ...championDisplay(view.tournament.winner_id, champion?.username ?? null, view.matches),
          finalOutcomeKind: finalMatch ? tournamentOutcomeKind(finalMatch) : null,
          placements: view.registrations
            .filter((reg) => reg.placement !== null)
            .sort((a, b) => (a.placement ?? Number.POSITIVE_INFINITY) - (b.placement ?? Number.POSITIVE_INFINITY))
            .map((reg) => ({
              userId: reg.user_id,
              username: reg.username ?? null,
              rating: reg.rating ?? null,
              placement: reg.placement,
              placementLabel: placementLabelForRank(reg.placement),
              seed: reg.seed,
              status: reg.status,
            })),
        },
      });
    } catch (err) {
      sendInternal(res, err);
    }
  });

  app.post('/api/tournaments/:id/register', async (req: Request, res: Response) => {
    if (respondIfTournamentsDisabled(res, 'refuse')) return;
    const tournamentId = requireTournamentId(req, res);
    if (!tournamentId) return;
    // A guest (anonymous session) is signed in but may not take part in tournaments until they make an account.
    const userId = await requireAuthUserId(req, res, { rejectGuests: true });
    if (!userId) return;
    const mismatch = rejectMismatchedPayloadUserId(userId, req.body?.userId);
    if (mismatch) {
      sendAuthError(res, mismatch);
      return;
    }
    try {
      // Status, close time (database clock) and the seat cap are all checked
      // inside one locked transaction; see register_for_tournament.
      const result = await registerForTournament(tournamentId, userId);
      if (result.already_registered) {
        res.json({ ok: true, alreadyRegistered: true });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      sendRegistrationRpcError(res, err);
    }
  });

  app.delete('/api/tournaments/:id/register', async (req: Request, res: Response) => {
    if (respondIfTournamentsDisabled(res, 'refuse')) return;
    const tournamentId = requireTournamentId(req, res);
    if (!tournamentId) return;
    const userId = await requireAuthUserId(req, res);
    if (!userId) return;
    const mismatch = rejectMismatchedPayloadUserId(userId, req.body?.userId);
    if (mismatch) {
      sendAuthError(res, mismatch);
      return;
    }
    try {
      // Rejected with withdraw_closed once registration has closed; a
      // registration is never deleted after the bracket exists.
      await withdrawFromTournament(tournamentId, userId);
      res.json({ ok: true });
    } catch (err) {
      sendRegistrationRpcError(res, err);
    }
  });
}

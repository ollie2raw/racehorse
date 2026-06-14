import type { Express, Request, Response } from 'express';
import { isSupabaseTimeoutError, supabaseFetch } from '../supabaseUtils';
import { placementLabelForRank } from './engine';
import {
  fetchRegistrationsWithProfile,
  fetchUpcomingTournaments,
  fetchTournamentById,
  fetchBracketView,
  fetchActiveAssignedMatchForUser,
  fetchRegistrationsForUser,
  fetchActiveRegistration,
  fetchRegistrations,
  fetchMatches,
  insertRegistration,
  isValidUuid,
  withdrawRegistration,
} from './persistence';
import { humanJoinedAt, isBotUserId } from './matchDispatch';
import { buildTournamentMeState } from './meState';
import {
  rejectMismatchedPayloadUserId,
  requireAuthUserId,
  sendAuthError,
} from './tournamentAuth';

async function requireAuth(
  req: Request,
  res: Response,
  opts: { allowAnonymous?: boolean } = {},
): Promise<string | null> {
  return requireAuthUserId(req, res, opts);
}

function requireTournamentId(req: Request, res: Response): string | null {
  const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
  if (!isValidUuid(id)) {
    res.status(400).json({ ok: false, error: 'invalid_tournament_id' });
    return null;
  }
  return id;
}

export function registerTournamentRoutes(app: Express): void {
  // Static paths must be registered before /:id so "me", "upcoming", etc. are not captured.
  app.get('/api/tournaments/upcoming', async (_req: Request, res: Response) => {
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
      res.json({ ok: true, tournaments: enriched });
    } catch (err) {
      if (isSupabaseTimeoutError(err)) {
        console.warn('[tournament:upcoming] upstream timeout', {
          ms: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        });
        res.status(503).json({ ok: false, error: 'upstream_timeout', tournaments: [] });
        return;
      }
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.get('/api/tournaments/my', async (req: Request, res: Response) => {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    try {
      const regs = await fetchRegistrationsForUser(userId);
      res.json({ ok: true, registrations: regs });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.get('/api/tournaments/me', async (req: Request, res: Response) => {
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
      const tournamentsById = new Map(
        (await Promise.all(tournamentIds.map((id) => fetchTournamentById(id))))
          .filter((t): t is NonNullable<typeof t> => Boolean(t))
          .map((t) => [t.id, t] as const),
      );
      const matchesByTournamentId = new Map(
        await Promise.all(
          tournamentIds.map(async (id) => [id, await fetchMatches(id)] as const),
        ),
      );
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

      const activeAssignedMatch = await fetchActiveAssignedMatchForUser(userId);
      const activeAssignedPayload = activeAssignedMatch
        ? (() => {
            const { match, tournament, opponentUsername } = activeAssignedMatch;
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
          })()
        : null;

      if (activeAssignedPayload) {
        console.log('[tournament:recovery] activeAssignedMatch', {
          userId,
          matchId: activeAssignedPayload.matchId,
          status: activeAssignedPayload.matchStatus,
          roomCodeExists: Boolean(activeAssignedPayload.roomCode),
          round: activeAssignedPayload.round,
          deadline: activeAssignedPayload.readyDeadlineAt,
        });
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
        console.log('[tournament:me] completed result state', {
          tournamentId: meState.activeTournamentId,
          matchId: completedMatch?.id ?? null,
        });
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
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.get('/api/tournaments/history', async (req: Request, res: Response) => {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    try {
      const regs = await fetchRegistrationsForUser(userId);
      const completedRegs = regs.filter((reg) => reg.placement !== null);
      const history = await Promise.all(
        completedRegs.map(async (reg) => {
          const [tournament, withProfiles] = await Promise.all([
            fetchTournamentById(reg.tournament_id),
            fetchRegistrationsWithProfile(reg.tournament_id),
          ]);
          if (!tournament) return null;
          const champion = withProfiles.find((entry) => entry.user_id === tournament.winner_id) ?? null;
          return {
            tournamentId: tournament.id,
            scheduledStart: tournament.scheduled_start,
            format: tournament.format,
            winTarget: tournament.win_target,
            placement: reg.placement,
            placementLabel: placementLabelForRank(reg.placement),
            championId: tournament.winner_id,
            championName: champion?.username ?? null,
          };
        }),
      );
      const filteredHistory = history.filter(
        (entry): entry is NonNullable<typeof entry> => Boolean(entry),
      );
      res.json({
        ok: true,
        history: filteredHistory.sort(
          (a, b) => Date.parse(b.scheduledStart) - Date.parse(a.scheduledStart),
        ),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.get('/api/tournaments/:id/bracket', async (req: Request, res: Response) => {
    const tournamentId = requireTournamentId(req, res);
    if (!tournamentId) return;
    try {
      const view = await fetchBracketView(tournamentId);
      if (!view) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
      res.json({ ok: true, view });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.get('/api/tournaments/:id', async (req: Request, res: Response) => {
    const tournamentId = requireTournamentId(req, res);
    if (!tournamentId) return;
    try {
      const t = await fetchTournamentById(tournamentId);
      if (!t) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
      res.json({ ok: true, tournament: t });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.get('/api/tournaments/:id/result', async (req: Request, res: Response) => {
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
      res.json({
        ok: true,
        result: {
          tournamentId: view.tournament.id,
          scheduledStart: view.tournament.scheduled_start,
          format: view.tournament.format,
          winTarget: view.tournament.win_target,
          championId: view.tournament.winner_id,
          championName: champion?.username ?? null,
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
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.post('/api/tournaments/:id/register', async (req: Request, res: Response) => {
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
      const t = await fetchTournamentById(tournamentId);
      if (!t) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
      if (t.status !== 'registration_open') {
        res.status(409).json({ ok: false, error: 'registration_closed' });
        return;
      }
      const regs = await fetchRegistrations(t.id);
      if (regs.filter((r) => r.status === 'registered').length >= t.max_players) {
        res.status(409).json({ ok: false, error: 'full' });
        return;
      }
      const existing = await fetchActiveRegistration(t.id, userId);
      if (existing && existing.status === 'registered') {
        res.json({ ok: true, alreadyRegistered: true });
        return;
      }
      await insertRegistration(t.id, userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.delete('/api/tournaments/:id/register', async (req: Request, res: Response) => {
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
      await withdrawRegistration(tournamentId, userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });
}

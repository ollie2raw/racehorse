import type { Express, Request, Response } from 'express';
import { supabaseFetch } from '../supabaseUtils';
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
  insertRegistration,
  isValidUuid,
  withdrawRegistration,
} from './persistence';
import { humanJoinedAt, isBotUserId } from './matchDispatch';

async function requireAuth(
  req: Request,
  res: Response,
  opts: { allowAnonymous?: boolean } = {},
): Promise<string | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    if (opts.allowAnonymous) return null;
    res.status(401).json({ ok: false, error: 'not_authenticated' });
    return null;
  }
  try {
    const userData = await supabaseFetch<{ id?: string }>(
      '/auth/v1/user',
      { headers: { Authorization: `Bearer ${token}` } } as RequestInit,
    );
    const userId = userData?.id ?? null;
    if (!isValidUuid(userId)) {
      if (opts.allowAnonymous) return null;
      res.status(401).json({ ok: false, error: 'not_authenticated' });
      return null;
    }
    return userId.trim();
  } catch {
    if (opts.allowAnonymous) return null;
    res.status(401).json({ ok: false, error: 'not_authenticated' });
    return null;
  }
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
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.get('/api/tournaments/my', async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : null;
    if (!userId) { res.status(400).json({ ok: false, error: 'missing_userId' }); return; }
    if (!isValidUuid(userId)) { res.status(400).json({ ok: false, error: 'invalid_user' }); return; }
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
      res.json({ ok: true, registrations: [], activeAssignedMatch: null });
      return;
    }
    try {
      const [regs, activeAssignedMatch] = await Promise.all([
        fetchRegistrationsForUser(userId),
        fetchActiveAssignedMatchForUser(userId),
      ]);
      const activeAssignedPayload = activeAssignedMatch
        ? (() => {
            const { match, tournament, opponentUsername } = activeAssignedMatch;
            if (match.status !== 'ready' && match.status !== 'in_progress') {
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

      res.json({
        ok: true,
        registrations: regs,
        activeAssignedMatch: activeAssignedPayload,
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
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : null;
    if (!userId) { res.status(400).json({ ok: false, error: 'missing_userId' }); return; }
    if (!isValidUuid(userId)) { res.status(400).json({ ok: false, error: 'invalid_user' }); return; }
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
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : null;
    if (!userId) { res.status(400).json({ ok: false, error: 'missing_userId' }); return; }
    if (!isValidUuid(userId)) { res.status(400).json({ ok: false, error: 'invalid_user' }); return; }
    try {
      await withdrawRegistration(tournamentId, userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });
}

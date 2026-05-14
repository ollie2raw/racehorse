import type { Express, Request, Response } from 'express';
import {
  fetchUpcomingTournaments,
  fetchTournamentById,
  fetchBracketView,
  fetchRegistrationsForUser,
  fetchActiveRegistration,
  fetchRegistrations,
  insertRegistration,
  withdrawRegistration,
} from './persistence';

export function registerTournamentRoutes(app: Express): void {
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
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    if (!userId) { res.status(400).json({ ok: false, error: 'missing_userId' }); return; }
    try {
      const regs = await fetchRegistrationsForUser(userId);
      res.json({ ok: true, registrations: regs });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.get('/api/tournaments/:id/bracket', async (req: Request, res: Response) => {
    try {
      const view = await fetchBracketView(req.params.id);
      if (!view) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
      res.json({ ok: true, view });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.get('/api/tournaments/:id', async (req: Request, res: Response) => {
    try {
      const t = await fetchTournamentById(req.params.id);
      if (!t) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
      res.json({ ok: true, tournament: t });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.post('/api/tournaments/:id/register', async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    if (!userId) { res.status(400).json({ ok: false, error: 'missing_userId' }); return; }
    try {
      const t = await fetchTournamentById(req.params.id);
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
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    if (!userId) { res.status(400).json({ ok: false, error: 'missing_userId' }); return; }
    try {
      await withdrawRegistration(req.params.id, userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });
}

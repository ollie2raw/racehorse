import type { Application } from 'express';
import { listActiveDisconnectGraceSeats } from '../../multiplayer/disconnectGrace';

export function registerE2eInspectRoutes(app: Application): void {
  if (process.env.NODE_ENV === 'production' || process.env.E2E_INSPECT !== '1') return;

  app.get('/api/e2e/disconnect-grace/:roomCode', (req, res) => {
    const roomCode = String(req.params.roomCode ?? '').trim().toUpperCase();
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      roomCode,
      seats: listActiveDisconnectGraceSeats(roomCode),
    });
  });
}

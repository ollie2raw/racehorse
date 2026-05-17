import { describe, expect, it } from 'vitest';
import {
  evaluateTournamentAttachGuard,
  TOURNAMENT_ATTACH_FAILURE_BACKOFF_MS,
} from '../../../client/src/tournament/tournamentAttachGuard';

describe('evaluateTournamentAttachGuard', () => {
  it('blocks duplicate attach while pending for the same matchId', () => {
    const result = evaluateTournamentAttachGuard({
      matchId: 'm-1',
      socketConnected: true,
      appMode: 'tournament',
      pendingMatchId: 'm-1',
      attachedMatchId: null,
      failedAtByMatchId: {},
    });
    expect(result).toEqual({ proceed: false, reason: 'already-pending' });
  });

  it('blocks when already attached in multiplayer', () => {
    const result = evaluateTournamentAttachGuard({
      matchId: 'm-1',
      socketConnected: true,
      appMode: 'multiplayer',
      pendingMatchId: null,
      attachedMatchId: 'm-1',
      failedAtByMatchId: {},
    });
    expect(result).toEqual({ proceed: false, reason: 'already-attached' });
  });

  it('allows one attach per matchId when recovery object identity would change', () => {
    const first = evaluateTournamentAttachGuard({
      matchId: 'm-1',
      socketConnected: true,
      appMode: 'tournament',
      pendingMatchId: null,
      attachedMatchId: null,
      failedAtByMatchId: {},
    });
    expect(first.proceed).toBe(true);

    const second = evaluateTournamentAttachGuard({
      matchId: 'm-1',
      socketConnected: true,
      appMode: 'tournament',
      pendingMatchId: 'm-1',
      attachedMatchId: null,
      failedAtByMatchId: {},
    });
    expect(second).toEqual({ proceed: false, reason: 'already-pending' });
  });

  it('respects failure backoff unless manual retry', () => {
    const now = Date.now();
    const blocked = evaluateTournamentAttachGuard({
      matchId: 'm-1',
      socketConnected: true,
      appMode: 'tournament',
      pendingMatchId: null,
      attachedMatchId: null,
      failedAtByMatchId: { 'm-1': now - 1_000 },
      nowMs: now,
    });
    expect(blocked).toEqual({ proceed: false, reason: 'backoff' });

    const manual = evaluateTournamentAttachGuard({
      matchId: 'm-1',
      socketConnected: true,
      appMode: 'tournament',
      pendingMatchId: null,
      attachedMatchId: null,
      failedAtByMatchId: { 'm-1': now - 1_000 },
      nowMs: now,
      manual: true,
    });
    expect(manual.proceed).toBe(true);
    expect(TOURNAMENT_ATTACH_FAILURE_BACKOFF_MS).toBeGreaterThan(0);
  });
});

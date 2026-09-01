import { describe, expect, it } from 'vitest';
import {
  roomKind,
  isScheduledTournamentRoom,
  isLegacyLeagueRoom,
  isAnyTournamentRoom,
} from './roomKind';

describe('roomKind', () => {
  it('classifies by precedence: scheduled_tournament > legacy_league > matchmaking > private', () => {
    expect(roomKind({})).toBe('private');
    expect(roomKind({ matchmakingMatchId: 'mm-1' })).toBe('matchmaking');
    expect(roomKind({ config: { tournamentId: 'league-1' } })).toBe('legacy_league');
    expect(roomKind({ scheduledTournamentMatchId: 'm-1' })).toBe('scheduled_tournament');

    // A room carrying more than one marker resolves to the highest-precedence one.
    expect(
      roomKind({ scheduledTournamentMatchId: 'm-1', config: { tournamentId: 'league-1' } }),
    ).toBe('scheduled_tournament');
    expect(
      roomKind({ config: { tournamentId: 'league-1' }, matchmakingMatchId: 'mm-1' }),
    ).toBe('legacy_league');
  });

  it('treats empty-string / null markers as absent', () => {
    expect(roomKind({ scheduledTournamentMatchId: '', matchmakingMatchId: null })).toBe('private');
    expect(roomKind({ config: { tournamentId: null } })).toBe('private');
  });

  it('helper predicates agree with roomKind', () => {
    const scheduled = { scheduledTournamentMatchId: 'm-1' };
    const legacy = { config: { tournamentId: 'league-1' } };
    const priv = {};

    expect(isScheduledTournamentRoom(scheduled)).toBe(true);
    expect(isLegacyLeagueRoom(scheduled)).toBe(false);
    expect(isAnyTournamentRoom(scheduled)).toBe(true);

    expect(isScheduledTournamentRoom(legacy)).toBe(false);
    expect(isLegacyLeagueRoom(legacy)).toBe(true);
    expect(isAnyTournamentRoom(legacy)).toBe(true);

    expect(isAnyTournamentRoom(priv)).toBe(false);
  });
});
